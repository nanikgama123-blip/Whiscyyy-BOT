import { SlashCommandBuilder } from 'discord.js';
import { stopQueue } from '../../services/musicService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Stops the music and clears the queue.')
        .setDMPermission(false),
    category: 'Music',
    prefixSupport: true,

    async execute(interaction, config, client) {
        await InteractionHelper.safeDefer(interaction);

        const success = await stopQueue(interaction.guildId);

        if (success) {
            await InteractionHelper.safeEditReply(interaction, { content: '🛑 Stopped the music and cleared the queue. Still staying in the voice channel for 24/7 Pois!' });
        } else {
            await InteractionHelper.safeEditReply(interaction, { content: '❌ No music is currently playing.' });
        }
    }
};
