const testPostMode = false;

const fetch = require('node-fetch');

const tag_translatepriority = 'translate-priority';
const translationUpdateEndpointUrl = 'https://workflow.avant.tools/subscribers/xtm';

const postTranslations = async translationUpdatePayload => {
  const postBody = {
    posts: translationUpdatePayload
  };
  if(testPostMode) {
    postBody.test = 1;
  }
  const payload = {
      method: 'POST',
      body: JSON.stringify(postBody)
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
  postTranslations,
  translationUpdateAddPost
}