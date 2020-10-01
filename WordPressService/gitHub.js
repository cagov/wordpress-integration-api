const gitAuthheader = () => ({
  'Authorization' : `Bearer ${process.env["GITHUB_TOKEN"]}`,
  'Content-Type': 'application/json'
});

const gitDefaultOptions = () => ({method: 'GET', headers:gitAuthheader() });

//Common function for creating a PUT option
const gitPutOptions = bodyJSON =>
    ({
        method: 'PUT',
        headers: gitAuthheader(),
        body: JSON.stringify(bodyJSON)
    });

const gitHubMessage = (action, file) => `${action} - ${file}`;

module.exports = {
  gitAuthheader,
  gitDefaultOptions,
  gitHubMessage,
  gitPutOptions
}