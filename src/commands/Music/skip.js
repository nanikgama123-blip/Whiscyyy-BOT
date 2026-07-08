import { SlashCommandBuilder } from 'discord.js';
import { skipSong } from '../../services/musicService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Skips the currently playing song.')
        .setDMPermission(false),
    category: 'Music',
    prefixSupport: true,

    async execute(interaction, config, client) {
        await InteractionHelper.safeDefer(interaction);

        const success = await skipSong(interaction.guildId);

        if (success) {
            await InteractionHelper.safeEditReply(interaction, { content: '⏭️ Skipped the current song!' });
        } else {
            await InteractionHelper.safeEditReply(interaction, { content: '❌ No music is currently playing to skip.' });
        }
    }
};
