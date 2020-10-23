const fetch = require('node-fetch');
const slackApiChatPost = 'https://slack.com/api/chat.postMessage';
const appName = 'cagov Slackbot';

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

const slackBotReportError = async (channel,title,e,req) => {
  console.error(e);

  const slackAttachment = 
      [
          {
              fallback: e.toString(),
              color: "#f00",
              pretext: title,
              title: e.toString(),
              fields: [
                  {
                      title: "Stack",
                      value: e.stack,
                      short: false
                  }
              ],
              footer: appName,
              ts: new Date().getTime()
          }
      ];

  if (req) {
    slackAttachment[0].fields.push({
      title: "Request",
      value: JSON.stringify(req), //no formatting on purpose.
      short: false
    });
  }

  return await slackBotChatPost(channel,null,slackAttachment);
}

module.exports = {
  slackBotChatPost,
  slackBotReportError
}