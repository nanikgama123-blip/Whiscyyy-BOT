import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getWhiscyData, setWhiscyData } from '../../services/whiscy/inventoryService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('whiscyadmin')
    .setDescription('Owner only command to manage user whiscy.')
    .addSubcommand(sub => 
      sub.setName('set')
      .setDescription('Set a user\'s whiscy balance')
      .addUserOption(opt => opt.setName('user').setDescription('Target user').setRequired(true))
      .addIntegerOption(opt => opt.setName('amount').setDescription('Amount to set').setRequired(true))
    )
    .addSubcommand(sub => 
      sub.setName('add')
      .setDescription('Add to a user\'s whiscy balance')
      .addUserOption(opt => opt.setName('user').setDescription('Target user').setRequired(true))
      .addIntegerOption(opt => opt.setName('amount').setDescription('Amount to add').setRequired(true))
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),
  category: 'Economy',
  prefixSupport: true,

  async execute(interaction, config, client) {
    try {
      await InteractionHelper.safeDefer(interaction);

      // Pastikan hanya owner bot yang bisa mengeksekusi
      if (!client.config.bot.commands.owners.includes(interaction.user.id)) {
        const embed = new EmbedBuilder()
          .setColor('#e74c3c')
          .setDescription('❌ Only the bot owner can use this command.');
        return await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
      }

      const subcommand = interaction.options.getSubcommand();
      const targetUser = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount');
      const guildId = interaction.guildId;

      const data = await getWhiscyData(client, guildId, targetUser.id);

      if (subcommand === 'set') {
        data.wallet = amount;
      } else if (subcommand === 'add') {
        data.wallet = (data.wallet || 0) + amount;
      }

      // Pastikan field registered juga true jika owner memberikan uang pada player baru
      data.registered = true;

      await setWhiscyData(client, guildId, targetUser.id, data);

      const embed = new EmbedBuilder()
        .setColor('#2ecc71')
        .setTitle('🛠️ Owner Tool')
        .setDescription(`Successfully ${subcommand === 'set' ? 'set' : 'added'} **${amount.toLocaleString()}** whiscy 🪙 to <@${targetUser.id}>.\n\nNew Balance: **${data.wallet.toLocaleString()}**`);

      await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    } catch (error) {
      logger.error('Whiscyadmin command error:', error);
      await handleInteractionError(interaction, error, { type: 'command', commandName: 'whiscyadmin' });
    }
  },
};
