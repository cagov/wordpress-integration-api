const fetch = require('node-fetch');
const {
    gitHubMessage,
    gitHubBranchCreate,
    gitHubBranchMerge,
    gitHubFileDelete,
    gitHubFileUpdate,
    gitHubFileAdd,
    gitHubFileGet,
    gitHubFileGetBlob,
    gitHubBranchExists,
    gitHubPrGetByName
} = require('./gitHub');

const PrLabels = ['Automatic Deployment'];

const doDailyStatsPr = async mergetargets => {
    for(const mergetarget of mergetargets) {
        const branch = `auto-stats-update-${mergetarget}-${getTodayPacificTime().replace(/\//g,'-')}`;
//const branch = 'synctest3_wpservice_deploy_ping-95865781';
        if(await gitHubBranchExists(branch)) {console.log(`Branch ${branch} found...skipping`); continue;} //branch exists, probably another process working on it...skip

        const PR = await gitHubPrGetByName(mergetarget,branch);
        if(PR) {console.log(`PR ${branch} found...skipping`); continue;}; //PR found, nothing to do
        
        await gitHubBranchCreate(branch,mergetarget);
        await gitHubFileAdd('TEST','src/test.txt','adding a file',branch);
        await gitHubBranchMerge(branch,mergetarget,true,'(TEST) PR - ' + branch,PrLabels,false);
    }
}

const getTodayPacificTime = () =>
    new Date().toLocaleString("en-US", {year: 'numeric', month: 'numeric', day: 'numeric', timeZone: "America/Los_Angeles"});

module.exports = {
  doDailyStatsPr
}