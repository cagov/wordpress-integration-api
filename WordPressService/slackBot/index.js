const fetch = require('node-fetch');
const slackApiChatPost = 'https://slack.com/api/chat.postMessage';

//For help building attachments...go here...
//https://api.slack.com/docs/messages/builder

const slackBotGetToken = () => {
  const token = process.env["SLACKBOT_TOKEN"];

  if (!token) {
    //developers that don't set the creds can still use the rest of the code
    console.error('You need local.settings.json to contain "SLACKBOT_TOKEN" to use slackbot features.');
    return;
  }

  return token;
}

const slackApiPost = bodyJSON =>
    ({
        method: 'POST',
        headers: {
          'Authorization' : `Bearer ${slackBotGetToken()}`,
          'Content-Type': 'application/json;charset=utf-8'
        },
        body: JSON.stringify(bodyJSON)
    });

const slackBotChatPost = async (channel,text,attachments) => {
  const payload = {
    channel,
    text,
    attachments
  }

  return await fetch(slackApiChatPost,slackApiPost(payload));
}

module.exports = {
  slackBotChatPost
}