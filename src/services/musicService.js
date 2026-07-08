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
import { EmbedBuilder } from 'discord.js';
import { InteractionHelper } from '../utils/interactionHelper.js';

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

export async function addAndPlay(interaction, guildId, query) {
    let queueData = queues.get(guildId);
    
    // Check if connected to voice
    const connection = getVoiceConnection(guildId);
    if (!connection) {
        return { success: false, message: 'I need to be in a voice channel first! Use `w!join`.' };
    }

    // Search and validate
    let songInfo;
    try {
        const isUrl = query.startsWith('http');
        if (isUrl) {
            const ytInfo = await play.video_info(query);
            songInfo = ytInfo.video_details;
        } else {
            const searchResults = await play.search(query, { limit: 1 });
            if (!searchResults || searchResults.length === 0) {
                return { success: false, message: 'Could not find any matching songs on YouTube.' };
            }
            songInfo = searchResults[0];
        }
    } catch (error) {
        logger.error('Music search error:', error);
        return { success: false, message: 'Failed to search YouTube. The video might be restricted or age-gated.' };
    }

    const song = {
        title: songInfo.title,
        url: songInfo.url,
        duration: songInfo.durationRaw,
        thumbnail: songInfo.thumbnails?.[0]?.url,
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
        };

        // Subscribe connection to player
        connection.subscribe(queueData.player);

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
            }
        });

        queueData.player.on('error', error => {
            logger.error(`Audio player error in ${guildId}:`, error);
            queueData.player.stop(); // Try to skip to next
        });

        queues.set(guildId, queueData);
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
