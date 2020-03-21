const fetch = require('node-fetch')
const defaultoptions = require("../util/gitOptions.js");

module.exports = function(success, failure, githubBranch, githubApiUrl, fileLocation) {
  fetch(`${githubApiUrl}contents/${fileLocation}?ref=${githubBranch}`,
    defaultoptions())
    .then(res => res.ok ? res.json() : success([]))
    .then(json => { 
      success(json)
    }
  )
  .catch(async res => {
    failure('wtf');
  });
}