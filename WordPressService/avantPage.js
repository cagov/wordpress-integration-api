const testPostMode = false;

const fetch = require('node-fetch');
const {
  gitHubMessage,
  gitHubBranchCreate,
  gitHubBranchMerge,
  gitHubFileUpdate,
  gitHubFileAdd,
  gitHubFileGet
} = require('./gitHub');
const autoApproveTranslationPrs = true;
const githubTranslationPingsPath = `pages/translations/pings`;
const githubTranslationContentPath = `pages/translations/content`;
const githubTranslationFlatPath = `pages/translated-posts`;
const tag_translatepriority = 'translate-priority';
const translationDownloadUrl = `https://storage.googleapis.com/covid19-ca-files-avantpage/`;
const translationUpdateEndpointUrl = 'https://workflow.avant.tools/subscribers/xtm';
const translatedLanguages = [
    {code:'ar_AA',tag:'lang-ar',slugpostfix:'ar'},
    {code:'es_US',tag:'lang-es',slugpostfix:'es'},
    {code:'ko_KR',tag:'lang-ko',slugpostfix:'ko'},
    {code:'tl_PH',tag:'lang-tl',slugpostfix:'tl'},
    {code:'vi_VN',tag:'lang-vi',slugpostfix:'vi'},
    {code:'zh_TW',tag:'lang-zh-Hant',slugpostfix:'zh-hant'},
    {code:'zh_CN',tag:'lang-zh-Hans',slugpostfix:'zh-hans'}
];
const TranslationPrLabels = ['Translated Content'];

const getTranslatedPageData = html => {
  //clean up any input issues

  //remove arabic reverse (RTL override) if it is at the beginning
  while (html.charCodeAt(0)===8294) html=html.substring(1);

  return html.trimLeft();
}

//TOOD: this is a duplicate in index.js
const branchCreate_WithName = async (filename,mergetarget) => {
  const branch = mergetarget + '_wpservice_deploy_' + filename;
  await gitHubBranchCreate(branch,mergetarget);
  return branch;
}

//Add translation pings
const addTranslationPings = async (manifest,mergetargets,req) => {
  if(!req.body||req.headers['content-type']!=='application/json') return;

  for(const mergetarget of mergetargets) {

      const pingJSON = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

      const files_id = pingJSON.files_id;
      const newFileName = `ping-${files_id}-${new Date().getTime()}.json`;
      const newFilePath = `${githubTranslationPingsPath}/${newFileName}`;
      const branch = await branchCreate_WithName(`ping-${files_id}`,mergetarget);
      const content =  Buffer.from(JSON.stringify(pingJSON,null,2)).toString('base64');
      await gitHubFileAdd(
          content,
          newFilePath,
          gitHubMessage('Add translation ping',newFileName),
          branch
          )
          .then(() => {console.log(`Add translation ping Success: ${newFileName}`);});

      const translated_on = new Date(pingJSON.translated_on*1000);
      const posts = pingJSON.posts.map(x=>Number(x));

      if(!files_id||!translated_on||!posts) return;

      const sourceFiles = [];
      for(const post_id of posts) {
          const manifestrecord = manifest.posts.find(p=>p.id===post_id);

          if(manifestrecord) {
              const slug = manifestrecord.slug;
              sourceFiles.push(slug);

              for(const langRow of translatedLanguages) {
                  const newslug = `${slug}-${langRow.slugpostfix}`;
                  const fileExtention = manifestrecord.isTableData ? 'json' : 'html';

                  const downloadContentName = `${slug}-${langRow.code}.${fileExtention}`;
                  const downloadFilePath = `${files_id}/${post_id}/${downloadContentName}`;
                  const downloadURL = `${translationDownloadUrl}${downloadFilePath}`;

                  const file = await fetch(downloadURL);
                  
                  if(file.status!==200) {
                      //Can't find the lang file
                      throw new Error(`FETCH FILE ERROR ${file.status} - ${downloadFilePath}`);
                  } else {
                      console.log(`processing...${downloadFilePath}`);

                      const html = getTranslatedPageData(await file.text());

                      let contentString = '';
                      if(manifestrecord.isFragment||manifestrecord.isTableData)
                          contentString = html;
                      else {
                          //replace the 'translate' tag with the correct lang tag

                          contentString = html.replace(/\"translate\"/,`\"translate\"\,\"${langRow.tag}\"`);
                      }
                      const content = Buffer.from(contentString).toString('base64');

                      const newContentName = `${newslug}.${fileExtention}`;
                      const newContentPath = `${githubTranslationContentPath}/${files_id}/${post_id}/${newContentName}`;

                      const existingContent = await gitHubFileGet(newContentPath,branch);
                      if(existingContent.sha) {
                          const json = existingContent;
                          await gitHubFileUpdate(
                              content,
                              json.url,
                              json.sha,
                              gitHubMessage('Update translation content',newContentName),
                              branch
                          )
                          .then(() => {console.log(`Update translation content Success: ${newContentName}`);});
                      } else {
                          await gitHubFileAdd(
                              content,
                              newContentPath,
                              gitHubMessage('Add translation content',newContentName),
                              branch
                          )
                          .then(() => {console.log(`Add translation content Success: ${newContentName}`);});
                      }

                      const newURL = `${githubTranslationFlatPath}/${newContentName}`;

                      const existingFileResponse = await gitHubFileGet(newURL,branch);

                      if(existingFileResponse.sha) {
                          //update
                          const json = existingFileResponse;

                          await gitHubFileUpdate(
                              content,
                              json.url,
                              json.sha,
                              gitHubMessage('Update translation',newContentName) + `\nSource : ${downloadURL}`,
                              branch
                          );

                          console.log(`UPDATE Success: ${newContentName}`);
                      } else {
                          //new
                          await gitHubFileAdd(
                              content,
                              `${githubTranslationFlatPath}/${newContentName}`,
                              gitHubMessage('Add translation',newContentName) + `\nSource : ${downloadURL}`,
                              branch
                          );
                          console.log(`ADD Success: ${newContentName}`);
                      }
                  }
              }
          }
      }

      await gitHubBranchMerge(
          branch,
          mergetarget,
          mergetarget===mergetargets[0],
          `Translation - ${sourceFiles.join(`, `)}`,
          TranslationPrLabels,
          autoApproveTranslationPrs
          );
  } //for
}

const postTranslations = async translationUpdatePayload => {
  const postBody = {
    posts: translationUpdatePayload
  };
  if(testPostMode) {
    postBody.test = 1;
  }
  const payload = {
      method: 'POST',
      body: JSON.stringify(testPostMode)
  };
  return fetch(translationUpdateEndpointUrl, payload)
      .then(() => {console.log(`Translation Update POST Success`);})
}

const translationUpdateAddPost = (Post, download_path, translationUpdatePayload) => {
  if(Post.translate) {
      //Send pages marked "translate"
      const translationRow = {
          id : Post.id, 
          slug : Post.slug, 
          modified : Post.modified,
          download_path // sample ... '/master/pages/wordpress-posts/reopening-matrix-data.json'
      };

//download_path should be testable by adding to...
//https://raw.githubusercontent.com/cagov/covid19

      if(Post.tags.includes(tag_translatepriority)) {
          //priority translation marked
          translationRow.priority = true;
      }

      translationUpdatePayload.push(translationRow);
  }
}

module.exports = {
  addTranslationPings,
  postTranslations,
  translationUpdateAddPost
}