// gamble.js — Coinflip and Slots gambling with whiscy

import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getWhiscyData, setWhiscyData, formatWhiscy } from '../../services/whiscy/inventoryService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';

const GAMBLE_COOLDOWN = 5_000;

const SLOT_EMOJIS = ['🍒', '🍋', '🍊', '🍇', '💎', '🪙', '⭐'];

export default {
  data: new SlashCommandBuilder()
    .setName('gamble')
    .setDescription('Gamble your whiscy!')
    .addSubcommand(sub =>
      sub
        .setName('coinflip')
        .setDescription('Flip a coin — 50/50 chance to double your bet!')
        .addIntegerOption(opt =>
          opt.setName('amount').setDescription('Amount of whiscy to bet').setRequired(true).setMinValue(1)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('slots')
        .setDescription('Spin the slot machine!')
        .addIntegerOption(opt =>
          opt.setName('amount').setDescription('Amount of whiscy to bet').setRequired(true).setMinValue(1)
        )
    )
    .setDMPermission(false),
  category: 'Economy',
  prefixSupport: true,

  async execute(interaction, config, client) {
    try {
      await InteractionHelper.safeDefer(interaction);

      const subcommand = interaction.options.getSubcommand();
      const amount = interaction.options.getInteger('amount');
      const userId = interaction.user.id;
      const guildId = interaction.guildId;

      const data = await getWhiscyData(client, guildId, userId);

      if ((data.wallet || 0) < amount) {
        const embed = new EmbedBuilder()
          .setColor('#e74c3c')
          .setDescription(`❌ You don't have enough whiscy! You have **${formatWhiscy(data.wallet || 0)}**.`);
        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
        return;
      }

      if (subcommand === 'coinflip') {
        await handleCoinflip(interaction, client, data, amount, userId, guildId);
      } else if (subcommand === 'slots') {
        await handleSlots(interaction, client, data, amount, userId, guildId);
      }
    } catch (error) {
      logger.error('Gamble command error:', error);
      await handleInteractionError(interaction, error, { type: 'command', commandName: 'gamble' });
    }
  },
};

async function handleCoinflip(interaction, client, data, amount, userId, guildId) {
  const won = Math.random() >= 0.5;
  const coinResult = won ? 'Heads' : 'Tails';
  const coinEmoji = won ? '🪙' : '💀';

  if (won) {
    data.wallet += amount;
  } else {
    data.wallet -= amount;
  }

  await setWhiscyData(client, guildId, userId, data);

  const animEmbed = new EmbedBuilder()
    .setColor('#f1c40f')
    .setTitle('🪙 Tossing the coin...')
    .setDescription('The coin is flipping high into the air... 🌪️')
    .setFooter({ text: `Betting ${amount.toLocaleString()} whiscy 🪙` });

  await InteractionHelper.safeEditReply(interaction, { embeds: [animEmbed] });
  await new Promise(resolve => setTimeout(resolve, 2500));

  logger.info(`[GAMBLE] Coinflip: ${userId} ${won ? 'won' : 'lost'} ${amount} whiscy`, {
    guildId, userId, won, amount,
  });

  const embed = new EmbedBuilder()
    .setColor(won ? '#2ecc71' : '#e74c3c')
    .setTitle(`${coinEmoji} Coin Flip — ${coinResult}!`)
    .setDescription(
      won
        ? `🎉 You won **${amount.toLocaleString()}** whiscy! 🪙`
        : `😔 You lost **${amount.toLocaleString()}** whiscy.`
    )
    .setFooter({ text: `Balance: ${data.wallet.toLocaleString()} whiscy 🪙` });

  await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
}

async function handleSlots(interaction, client, data, amount, userId, guildId) {
  // Spin 3 slots
  const results = [
    SLOT_EMOJIS[Math.floor(Math.random() * SLOT_EMOJIS.length)],
    SLOT_EMOJIS[Math.floor(Math.random() * SLOT_EMOJIS.length)],
    SLOT_EMOJIS[Math.floor(Math.random() * SLOT_EMOJIS.length)],
  ];

  // Check matches
  const allMatch = results[0] === results[1] && results[1] === results[2];
  const twoMatch = results[0] === results[1] || results[1] === results[2] || results[0] === results[2];

  let multiplier = 0;
  let resultText = '';

  if (allMatch) {
    multiplier = 10;
    resultText = `🎰 **JACKPOT!** All three match! x10!`;
  } else if (twoMatch) {
    multiplier = 2;
    resultText = `🎰 Two match! x2!`;
  } else {
    multiplier = 0;
    resultText = `🎰 No matches...`;
  }

  const winnings = amount * multiplier;
  const netGain = winnings - amount;

  if (multiplier > 0) {
    data.wallet += netGain;
  } else {
    data.wallet -= amount;
  }

  await setWhiscyData(client, guildId, userId, data);

  const animEmbed = new EmbedBuilder()
    .setColor('#f1c40f')
    .setTitle('🎰 Slot Machine')
    .setDescription(
      `> 🔄 │ 🔄 │ 🔄\n\n` +
      `Spinning the slots... 😵‍💫`
    )
    .setFooter({ text: `Betting ${amount.toLocaleString()} whiscy 🪙` });

  await InteractionHelper.safeEditReply(interaction, { embeds: [animEmbed] });
  await new Promise(resolve => setTimeout(resolve, 2500));

  logger.info(`[GAMBLE] Slots: ${userId} ${multiplier > 0 ? 'won' : 'lost'}, multiplier=${multiplier}`, {
    guildId, userId, amount, multiplier, results,
  });

  const embed = new EmbedBuilder()
    .setColor(multiplier > 0 ? '#2ecc71' : '#e74c3c')
    .setTitle('🎰 Slot Machine')
    .setDescription(
      `> ${results[0]} │ ${results[1]} │ ${results[2]}\n\n` +
      resultText + '\n\n' +
      (multiplier > 0
        ? `+**${winnings.toLocaleString()}** whiscy 🪙`
        : `-**${amount.toLocaleString()}** whiscy`)
    )
    .setFooter({ text: `Balance: ${data.wallet.toLocaleString()} whiscy 🪙` });

  await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
}