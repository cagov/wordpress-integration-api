const fetch = require('node-fetch');

module.exports =  async function(success,failure) {
  let url = 'https://www.gov.ca.gov/wp-json/wp/v2/posts?per_page=20'
  let newStuff = [];

  fetch(url)
    .then(res => res.ok ? res.json() : Promise.reject(res))
    .then(json => {
      json.forEach( (news) => {
        if(news.slug.indexOf('covid') > -1 || news.slug.indexOf('corona') > -1 || news.slug.indexOf('stay-at-home') > -1) {
          newStuff.push(news);
        }
      })
      success(newStuff);
    })
    .catch(async response => {
      const json = await res.json()
      failure('wtf');
    });
}

