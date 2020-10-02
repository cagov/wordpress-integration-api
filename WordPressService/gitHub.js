const fetch = require('node-fetch');
const { fetchJSON } = require('./fetchJSON');

const githubUser = 'cagov';
const githubRepo = 'covid19';
const githubApiUrl = `https://api.github.com/repos/${githubUser}/${githubRepo}/`;
const committer = {
  'name': 'WordPressService',
  'email': 'data@alpha.ca.gov'
};

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

const branchGetHeadUrl = branch => `${githubApiUrl}git/refs/heads/${branch}`;

//Return a branch head record
const branchGetHead = async branch =>
    fetchJSON(branchGetHeadUrl(branch),gitDefaultOptions());

const branchDelete = async branch => {
  //delete
  //https://developer.github.com/v3/git/refs/#delete-a-reference
  const deleteBody = {
      method: 'DELETE',
      headers: gitAuthheader()
  };
  const branchDeleteResult = await fetch(branchGetHeadUrl(branch), deleteBody);

  if(branchDeleteResult.status===204) {
      console.log(`BRANCH DELETE Success: ${branch}`);
  } else {
      console.log(`BRANCH DELETE N/A: ${branch}`);
  }
}

module.exports = {
  gitAuthheader,
  gitDefaultOptions,
  gitHubMessage,
  gitPutOptions,
  committer,
  branchDelete,
  branchGetHead,
  githubApiUrl
}