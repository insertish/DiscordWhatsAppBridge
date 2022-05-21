import makeWASocket, { DisconnectReason, useSingleFileAuthState } from '@adiwajshing/baileys'
import { Boom } from '@hapi/boom'

import { WebhookClient, Client } from 'discord.js';
import { config } from 'dotenv';
config();

const webhookClient = new WebhookClient({ url: process.env.WEBHOOK_URL! });

let activeSock: ReturnType<typeof makeWASocket> | null = null;

async function connectToWhatsApp () {
    const { state, saveState } = useSingleFileAuthState('./auth_info_multi.json')
    const sock = makeWASocket({
        // can provide additional config here
        printQRInTerminal: true,
        auth: state
    })
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update
        if(connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut
            console.log('connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect)
            // reconnect if not logged out
            if(shouldReconnect) {
                connectToWhatsApp()
            }
            activeSock = null;
        } else if(connection === 'open') {
            console.log('opened connection')
            activeSock = sock;
        }
    })
    sock.ev.on('messages.upsert', m => {
        console.log(JSON.stringify(m, undefined, 2))

        if (m.type === 'notify') {
            for (const message of m.messages) {
                const jid = message.key.remoteJid;
                if (jid === process.env.JID) {
                    if (message.message) {
                        let content = message.message.extendedTextMessage
                            ? message.message.extendedTextMessage.text
                            : message.message!.conversation;
                        
                        const quote = message.message.extendedTextMessage?.contextInfo?.quotedMessage?.conversation;
                        if (quote) {
                            content = `> ${quote}\n\n${content}`;
                        }

                        if (content) {
                            webhookClient.send({
                                content,
                                username: message.pushName!,
                                allowedMentions: {
                                    parse: [],
                                    repliedUser: false,
                                    roles: [],
                                    users: []
                                }
                            });
                        }
                    }
                }
            }
        }
    })
    sock.ev.on ('creds.update', saveState)
}

// run in main file
connectToWhatsApp()

const client = new Client({
    intents: ['GUILDS', 'GUILD_MESSAGES']
});

client.on('ready', () => console.log('Discord ready!'));

client.on('message', msg => {
    if (msg.author.id === client.user!.id) return;
    if (msg.author.id === process.env.WEBHOOK_ID) return;
    if (msg.channelId === process.env.DISCORD_CHANNEL) {
        if (activeSock) {
            const text = `*${msg.member?.nickname ?? msg.author.username}*: ${msg.content}`;
            console.log('Sending to WhatsApp', text);
            activeSock.sendMessage(process.env.JID!, {
                text
            })
            .then(console.log);
        } else {
            msg.reply('Socket is offline.');
        }
    }
});

client.login(process.env.TOKEN);
