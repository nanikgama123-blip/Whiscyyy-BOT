import { SlashCommandBuilder } from 'discord.js';
import { addAndPlay } from '../../services/musicService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';

export default {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song from YouTube.')
        .addStringOption(option => 
            option.setName('query')
                .setDescription('The name of the song or YouTube URL')
                .setRequired(true)
        )
        .setDMPermission(false),
    category: 'Music',
    prefixSupport: true,

    async execute(interaction, config, client) {
        try {
            await InteractionHelper.safeDefer(interaction);

            const query = interaction.options.getString('query');
            const result = await addAndPlay(interaction, interaction.guildId, query);

            if (!result.success) {
                return await InteractionHelper.safeEditReply(interaction, { content: `❌ ${result.message}` });
            }

            // Success message is handled via EditReply inside addAndPlay? No, addAndPlay returns a message.
            await InteractionHelper.safeEditReply(interaction, { content: result.message });
        } catch (error) {
            logger.error('Play command error:', error);
            await InteractionHelper.safeEditReply(interaction, { content: '❌ An error occurred while trying to play the song.' });
        }
    }
};
