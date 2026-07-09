import {
    joinVoiceChannel, 
    getVoiceConnection, 
    VoiceConnectionStatus, 
    entersState,
    createAudioPlayer,
    createAudioResource,
    NoSubscriberBehavior,
    AudioPlayerStatus,
    StreamType
} from '@discordjs/voice';
import { Readable } from 'stream';
import { logger } from '../utils/logger.js';

export async function saveVoiceChannel(client, guildId, channelId) {
    if (!client.db) return;
    await client.db.set(`guild:${guildId}:voice247`, { channelId });
}

export async function getSavedVoiceChannel(client, guildId) {
    if (!client.db) return null;
    const data = await client.db.get(`guild:${guildId}:voice247`);
    return data?.channelId || null;
}

export async function removeVoiceChannel(client, guildId) {
    if (!client.db) return;
    await client.db.delete(`guild:${guildId}:voice247`);
}

/**
 * Join the specified voice channel and setup 24/7 maintainer
 */
export async function joinAndMaintain(client, guild, channelId) {
    try {
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel) {
            logger.warn(`[Voice 24/7] Channel ${channelId} not found in guild ${guild.id}`);
            return false;
        }

        let connection = getVoiceConnection(guild.id);
        if (connection) {
            connection.destroy();
        }

        connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: true,
            selfMute: false,
        });

        // Trik Audio Hampa: Mencegah Discord menendang bot karena Idle/AFK
        class SilenceStream extends Readable {
            _read() {
                this.push(Buffer.alloc(960 * 2 * 2)); // 960 frames, 2 channels, 16-bit
            }
        }
        
        const player = createAudioPlayer({
            behaviors: { noSubscriber: NoSubscriberBehavior.Play }
        });
        const resource = createAudioResource(new SilenceStream(), { inputType: StreamType.Raw });
        
        player.play(resource);
        connection.subscribe(player);

        // Pastikan Audio Hampa terus berulang jika berhenti
        player.on(AudioPlayerStatus.Idle, () => {
            player.play(createAudioResource(new SilenceStream(), { inputType: StreamType.Raw }));
        });

        connection.on(VoiceConnectionStatus.Disconnected, async (oldState, newState) => {
            try {
                // Wait to see if it's just a channel move or network dip
                await Promise.race([
                    entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                    entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                ]);
            } catch (error) {
                // Connection died. Destroy and try to reconnect instantly
                logger.info(`[Voice 24/7] Disconnected in ${guild.id}. Reconnecting instantly...`);
                if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
                    connection.destroy();
                }
                
                setTimeout(async () => {
                    const savedId = await getSavedVoiceChannel(client, guild.id);
                    if (savedId) {
                        logger.info(`[Voice 24/7] Auto-reconnecting to channel ${savedId}...`);
                        joinAndMaintain(client, guild, savedId);
                    }
                }, 1000);
            }
        });

        connection.on('error', (error) => {
            logger.error(`[Voice 24/7] Connection error in ${guild.id}:`, error);
        });

        // Save it to DB so it persists across restarts
        await saveVoiceChannel(client, guild.id, channelId);
        logger.info(`[Voice 24/7] Successfully connected to ${channel.name} in ${guild.name}`);
        
        return true;
    } catch (err) {
        logger.error(`[Voice 24/7] Failed to join channel in ${guild.id}:`, err);
        return false;
    }
}

/**
 * Stop maintaining and leave
 */
export async function leaveAndStop(client, guildId) {
    const connection = getVoiceConnection(guildId);
    if (connection) {
        connection.destroy();
    }
    await removeVoiceChannel(client, guildId);
    logger.info(`[Voice 24/7] Stopped and left in ${guildId}`);
}

/**
 * Reconnect to all saved voice channels (call this on Ready event)
 */
export async function reconnectAllSavedVoices(client) {
    if (!client.db || !client.db.getAllKeys) return;
    
    const keys = await client.db.getAllKeys();
    const voiceKeys = keys.filter(k => k.startsWith('guild:') && k.endsWith(':voice247'));

    let count = 0;
    for (const key of voiceKeys) {
        const guildId = key.split(':')[1];
        const data = await client.db.get(key);
        if (data && data.channelId) {
            const guild = await client.guilds.fetch(guildId).catch(() => null);
            if (guild) {
                joinAndMaintain(client, guild, data.channelId);
                count++;
            } else {
                // Guild not found anymore, remove data
                await client.db.delete(key);
            }
        }
    }

    logger.info(`[Voice 24/7] Reconnected to ${count} voice channels.`);
}
