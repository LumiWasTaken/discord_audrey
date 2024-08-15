import { Message as DiscordMessage } from 'discord.js';
import { handleNewMessage, handleAiResponse, getConversationContext } from './databaseManager';
import Server from './server';
import logger from './logger';
import DiscordBot from '../bot';
import { ChannelContext } from './messagePreprocessor';
import { Message } from './apiFactory';

class MessageHandler {
  private bot: DiscordBot;

  constructor(bot: DiscordBot) {
    this.bot = bot;
  }

  async handleMessage(message: DiscordMessage): Promise<void> {
    if (message.author.bot) return; // Skip Bots
    if (message.channel.isDMBased()) return; // Skip DMs
    if (!message.guild) return; // Ensure message is from a guild


    const server = await this.bot.serverManager.getServer(message.guild.id);
    if (!server) {
      logger.warn(`Server not found in database: ${message.guild.name} (${message.guild.id})`);
      await this.bot.serverManager.addNewServer(message.guild.id, message.guild.name);
      return; // Skip processing this message, but the server will be added for future messages
    }

    if (!server.isChannelWhitelisted(message.channel.id)) return;

    if (message.reference) {
      await this.handleReply(message, server);
    } else if (message.content.startsWith('/chat') || message.mentions.has(this.bot.client.user?.id || '')) {
      await this.handleNewConversation(message, server);
    } 
  }

  private async handleNewConversation(message: DiscordMessage, server: Server): Promise<void> {
    if(message.channel.isDMBased()) return;

    const prompt = message.content.startsWith('/chat') 
      ? message.content.slice(5).trim()
      : message.content.trim();
    
    if (prompt.length === 0) {
      await message.reply('Please provide a message after mentioning me or using the /chat command.');
      return;
    }

    try {
      const newMessage = await handleNewMessage(
        message.client,
        server.id,
        message.author.id,
        message.author.username,
        message.id,
        prompt,
        message.channel.id,
      );

      const channelContext = await this.getChannelContext(message, server);
      const response = await server.generateResponse([newMessage], channelContext);
      const botMessage = await message.reply(response.content);
      await handleAiResponse(
        server.id,
        botMessage.id,
        response.content,
        message.id
      );
    } catch (error) {
      logger.error(`Error generating response: ${error}`);
      await message.reply("I'm sorry, but I encountered an error while processing your request.");
    }
  }

  private async handleReply(message: DiscordMessage, server: Server): Promise<void> {
    if(message.channel.isDMBased()) return;
    
    
    try {
      if (!message.reference?.messageId) {
        throw new Error('Referenced message ID not found');
      }

      const referencedMessage = await message.channel.messages.fetch(message.reference.messageId);
          // Check if the bot is the author of the referenced message
        if (referencedMessage.author.id !== this.bot.client.user?.id) {
          // If the bot is not the author, ignore this reply
          return;
        }

      const conversationHistory = await getConversationContext(message.reference.messageId);
      
      const newMessage = await handleNewMessage(
        message.client,
        server.id,
        message.author.id,
        message.author.username,
        message.id,
        message.content,
        message.channel.id,
        message.reference.messageId
      );

      conversationHistory.push(newMessage);

      const channelContext = await this.getChannelContext(message, server);
      const response = await server.generateResponse(conversationHistory, channelContext);

      const botMessage = await message.reply(response.content);
      await handleAiResponse(
        server.id,
        botMessage.id,
        response.content,
        message.id
      );
    } catch (error) {
      logger.error(`Error handling reply: ${error}`);
      await message.reply("I'm sorry, but I encountered an error while processing your reply.");
    }
  }

  private async getChannelContext(message: DiscordMessage, server: Server): Promise<ChannelContext> {
    if(message.channel.isDMBased()) throw "Channel is DM based, cannot get channel context";

    return {
      channelName: message.channel.name,
      serverName: message.guild?.name || 'Unknown Server',
      serverContext: server.serverContext,
      senderUsername: message.author.username,
      currentDate: new Date(),
      timeZone: 'Europe/Berlin' // You might want to make this configurable
    };
  }
}

export default MessageHandler;