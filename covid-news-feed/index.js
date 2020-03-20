const md5 = require('md5');
const githubApiUrl = "https://api.github.com/repos/cagov/covid19/";
const githubBranch = "staging";
const govArticleLoc = 'pages/guidancefeed/gov';
const cdphArticleLoc = 'pages/guidancefeed/cdph';
const addToGithub = require('./write/git.js');
const createGovItem = require('./templates/gov.js')
const createCDPHItem = require('./templates/cdph.js')
const govNews = require("./sources/gov.js");
const cdphNews = require("./sources/cdph.js");
const gitNews = require("./sources/git.js");
const getGovNews = new Promise((resolve, reject) => {
  govNews(resolve,reject);
});
const getCDPHNews = new Promise((resolve, reject) => {
  cdphNews(resolve,reject);
});
const getExistingGovNews = new Promise((resolve, reject) => {
  gitNews(resolve,reject, githubBranch, githubApiUrl, govArticleLoc);
});
const getExistingCDPHNews = new Promise((resolve, reject) => {
  gitNews(resolve,reject, githubBranch, githubApiUrl, cdphArticleLoc);
});

module.exports = async function(context, req) {
  await Promise.all([getGovNews, getExistingGovNews, getCDPHNews, getExistingCDPHNews]).then( 
    async function(values) {
      let writtenFileCount = 0;
      let newGovItems = values[0].filter(newItem => {
        return(values[1].filter(old => {
          return old.name === newItem.id+'.html';
        }).length < 1);
      });

      for(let i = 0;i<newGovItems.length;i++) {
        let item = newGovItems[i];
        await new Promise((resolve, reject) => {
          addToGithub(createGovItem(item), githubBranch, githubApiUrl, govArticleLoc, (result) => {
            if(result) {
              writtenFileCount++;
              resolve(result);
            } else {
              reject(result);
            }
          })
        })
      }

      let newCDPHItems = values[2].filter(newItem => {
        return(values[3].filter(old => {
          return old.name === md5(newItem.url)+'.html';
        }).length < 1);
      });

      for(let i = 0;i<newCDPHItems.length;i++) {
        let item = newCDPHItems[i];
        await new Promise((resolve, reject) => {
          addToGithub(createCDPHItem(item), githubBranch, githubApiUrl, cdphArticleLoc, (result) => {
            if(result) {
              writtenFileCount++;
              resolve(result);
            } else {
              reject(result);
            }
          })
        })
      }
      // respond with success here
      context.res = {
        body: {writtenFileCount},
        headers: {
          'Content-Type' : 'application/json'
        }
      };
      context.done();
    }
  );
};
