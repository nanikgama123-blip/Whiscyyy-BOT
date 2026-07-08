import play from 'play-dl';
import { 
    createAudioPlayer, 
    createAudioResource, 
    NoSubscriberBehavior, 
    AudioPlayerStatus,
    getVoiceConnection,
    StreamType
} from '@discordjs/voice';
import { logger } from '../utils/logger.js';
import { EmbedBuilder, ActivityType } from 'discord.js';
import { InteractionHelper } from '../utils/interactionHelper.js';
import config from '../config/application.js';
import { joinAndMaintain } from './voice247Service.js';

// Map to store guild music queues
// Structure: Map<guildId, { queue: Array, player: AudioPlayer, currentSong: Object, textChannel: Object }>
const queues = new Map();

export function getGuildQueue(guildId) {
    return queues.get(guildId) || null;
}

export async function stopQueue(guildId) {
    const queueData = queues.get(guildId);
    if (!queueData) return false;

    queueData.queue = [];
    if (queueData.player) {
        queueData.player.stop();
    }
    return true;
}

export async function skipSong(guildId) {
    const queueData = queues.get(guildId);
    if (!queueData || !queueData.player) return false;
    
    queueData.player.stop(); // This triggers AudioPlayerStatus.Idle, moving to next song
    return true;
}

let soundcloudInitialized = false;

async function initSoundCloud() {
    if (soundcloudInitialized) return;
    try {
        const clientID = await play.getFreeClientID();
        play.setToken({
            soundcloud: {
                client_id: clientID
            }
        });
        soundcloudInitialized = true;
        logger.info('[Music] SoundCloud Client ID initialized successfully');
    } catch (e) {
        logger.error('[Music] Failed to initialize SoundCloud Client ID:', e);
    }
}

export async function addAndPlay(interaction, guildId, query) {
    await initSoundCloud(); // Initialize SoundCloud dynamically

    let queueData = queues.get(guildId);
    
    let connection = getVoiceConnection(guildId);
    if (!connection) {
        // Auto-join if not connected
        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        const voiceChannel = member?.voice?.channel;
        if (!voiceChannel) {
            return { success: false, message: 'I need to be in a voice channel first! Join a voice channel so I can follow you.' };
        }
        const joined = await joinAndMaintain(interaction.client, interaction.guild, voiceChannel.id);
        if (!joined) {
            return { success: false, message: 'Failed to automatically join your voice channel. Check my permissions.' };
        }
        connection = getVoiceConnection(guildId);
    }

    // Search and validate
    let songInfo;
    try {
        const isUrl = query.startsWith('http');
        if (isUrl) {
            if (query.includes('youtube.com') || query.includes('youtu.be')) {
                const ytInfo = await Promise.race([
                    play.video_info(query),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 5000))
                ]);
                songInfo = ytInfo.video_details;
            } else {
                const info = await Promise.race([
                    play.soundcloud(query),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 5000))
                ]);
                songInfo = info;
            }
        } else {
            let searchResults;
            try {
                searchResults = await Promise.race([
                    play.search(query, { limit: 1, source: { soundcloud: 'tracks' } }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 5000))
                ]);
            } catch (err) {
                // Fallback to YouTube if SoundCloud hangs
                logger.warn('SoundCloud search timed out, falling back to YouTube');
                searchResults = await Promise.race([
                    play.search(query, { limit: 1 }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 5000))
                ]);
            }
            
            if (!searchResults || searchResults.length === 0) {
                return { success: false, message: 'Could not find any matching songs.' };
            }
            songInfo = searchResults[0];
        }
    } catch (error) {
        logger.error('Music search error:', error);
        const errMsg = error.message || '';
        if (errMsg.includes('429') || errMsg.includes('Sign in') || errMsg.includes('bot')) {
             return { success: false, message: 'YouTube blocked the server (Bot Protection). Please use a SoundCloud URL or just type the song name to search via SoundCloud.' };
        }
        return { success: false, message: 'Failed to search for the song. The video might be restricted, age-gated, or unsupported.' };
    }

    const song = {
        title: songInfo.title || songInfo.name,
        url: songInfo.url,
        duration: songInfo.durationRaw || 'Unknown',
        thumbnail: songInfo.thumbnails?.[0]?.url || songInfo.thumbnail,
        requester: interaction.user,
    };

    if (!queueData) {
        queueData = {
            queue: [],
            player: createAudioPlayer({
                behaviors: {
                    noSubscriber: NoSubscriberBehavior.Pause,
                },
            }),
            currentSong: null,
            textChannel: interaction.channel,
            client: interaction.client,
        };

        // Player Event Listeners
        queueData.player.on(AudioPlayerStatus.Idle, async () => {
            queueData.currentSong = null;
            if (queueData.queue.length > 0) {
                const nextSong = queueData.queue.shift();
                await playNext(guildId, nextSong);
            } else {
                // Queue finished. Connection stays alive because of 24/7 feature!
                if (queueData.textChannel) {
                    const embed = new EmbedBuilder()
                        .setColor('#3498db')
                        .setDescription('🎵 Queue has finished! Staying in the voice channel (24/7 Pois).');
                    queueData.textChannel.send({ embeds: [embed] }).catch(() => {});
                }
                if (queueData.client) {
                    queueData.client.user.setPresence(config.bot.presence);
                }
            }
        });

        queueData.player.on('error', error => {
            logger.error(`Audio player error in ${guildId}:`, error);
            queueData.player.stop(); // Try to skip to next
        });

        queues.set(guildId, queueData);
    }

    // Always ensure the active connection is subscribed to the player
    // This fixes the "playing but no sound" bug after an auto-join reconnection
    if (connection && queueData.player) {
        connection.subscribe(queueData.player);
    }

    queueData.textChannel = interaction.channel; // Update text channel

    if (queueData.player.state.status === AudioPlayerStatus.Playing || queueData.player.state.status === AudioPlayerStatus.Buffering) {
        queueData.queue.push(song);
        return { 
            success: true, 
            message: `Added to queue: **[${song.title}](${song.url})**`,
            song,
            isAddedToQueue: true
        };
    } else {
        // Start playing immediately
        await playNext(guildId, song);
        return { 
            success: true, 
            message: `Now playing: **[${song.title}](${song.url})**`,
            song,
            isAddedToQueue: false
        };
    }
}

async function playNext(guildId, song) {
    const queueData = queues.get(guildId);
    if (!queueData) return;

    try {
        const stream = await play.stream(song.url);
        const resource = createAudioResource(stream.stream, { 
            inputType: stream.type 
        });

        queueData.currentSong = song;
        queueData.player.play(resource);

        if (queueData.client) {
            queueData.client.user.setActivity(song.title, { type: ActivityType.Listening });
        }

        if (queueData.textChannel) {
            const embed = new EmbedBuilder()
                .setColor('#2ecc71')
                .setTitle('🎶 Now Playing')
                .setDescription(`**[${song.title}](${song.url})**\n\n⏱️ Duration: ${song.duration}\n👤 Requested by: ${song.requester.toString()}`);
                
            if (song.thumbnail) embed.setThumbnail(song.thumbnail);

            queueData.textChannel.send({ embeds: [embed] }).catch(() => {});
        }
    } catch (error) {
        logger.error(`Error playing audio in ${guildId}:`, error);
        if (queueData.textChannel) {
            queueData.textChannel.send('❌ Failed to play the song due to a stream error. Skipping...').catch(() => {});
        }
        // Skip
        queueData.player.stop();
    }
}
