const { fetchJSON } = require('./fetchJSON');
const GitHub = require('github-api');
const committer = {
  'name': 'WordPressService',
  'email': 'data@alpha.ca.gov'
};
const githubUser = 'cagov';
const githubRepo = 'covid19';
const gitHubMessage = (action, file) => `${action} - ${file}`;
const {
  postTranslations,
  translationUpdateAddPost
} = require('./avantPage');
const { slackBotReportError } = require('./slackBot');

const { JSDOM } = require('jsdom');
const sha1 = require('sha1');
const fs = require('fs');

//begin shadabase support
const shadabase = [];
const shamatch = (wp_sha, github_sha, wp_slug, wp_modified) =>
  shadabase.find(x=>x.wp_sha===wp_sha&&x.github_sha===github_sha&&x.slug===wp_slug&&x.modified===wp_modified);
//set the sha values in a file record
const shaupdate = (file, wp_sha, github_sha) => {
  if(wp_sha&&github_sha&&!shamatch(wp_sha, github_sha, file.slug, file.modified)) {
    shadabase.push({wp_sha, github_sha, slug:file.slug, modified:file.modified});
  }
};
//end shadabase support

let pinghistory = []; //Used to log updates

//const masterbranch='synctest3', stagingbranch='synctest3_staging', postTranslationUpdates = false;
const masterbranch='master', stagingbranch='staging', postTranslationUpdates = true;
const mergetargets = [masterbranch,stagingbranch];
const appName = 'WordPressService';
const githubSyncFolder = 'pages/wordpress-posts'; //no slash at the end
const wordPressUrl = 'https://as-go-covid19-d-001.azurewebsites.net';
const wordPressApiUrl = `${wordPressUrl}/wp-json/wp/v2/`;
const defaultTags = [];
const ignoreFiles = []; //No longer needed since manual-content folder used.
const tag_ignore = 'do-not-deploy';
const tag_translate = 'translate';
const tag_fragment = 'fragment';
const tag_table_data = 'table-data';
const tag_nocrawl = 'do-not-crawl';
const tag_langprefix = 'lang-';
const tag_langdefault = 'en';
const tag_nomaster = 'staging-only';
//const slackErrorChannel = 'C01H6RB99E2'; //Carter's debug channel
const slackErrorChannel = 'C01DBP67MSQ'; //Testingbot channel

module.exports = async function (context, req) {

  try { // The entire module
    const gitRepo = await new GitHub({token: process.env["GITHUB_TOKEN"]})
      .getRepo(githubUser,githubRepo);

    const translationUpdatePayload = []; //Translation DB

    if(req.method==='GET') {
    //Hitting the service by default will show the index page.
      context.res = {
        body: fs.readFileSync(`${appName}/index.html`,'utf8'),
        headers: {
          'Content-Type' : 'text/html'
        }
      };

      context.done();
      return;
    }

    //Logging data
    const started = getPacificTimeNow();
    let add_count = 0, update_count = 0, delete_count = 0, binary_match_count = 0, sha_match_count = 0, ignore_count = 0, staging_only_count = 0;

    //List of WP categories
    const categorylist = (await fetchJSON(`${wordPressApiUrl}categories?context=embed&hide_empty=true&per_page=100&orderby=slug&order=asc`))
      .map(x=>({id:x.id,name:x.name}));

    //List of WP Tags
    const taglist = (await fetchJSON(`${wordPressApiUrl}tags?context=embed&hide_empty=true&per_page=100&orderby=slug&order=asc`))
      .map(x=>({id:x.id,name:x.name}));

    const excerptToDescription = excerpt => excerpt.replace(/<p>/,'').replace(/<\/p>/,'').replace(/\n/,'').trim();

    //Query WP files
    const getWordPressPosts = async () => {
      const fetchoutput = {};
      //const fetchquery = `${wordPressApiUrl}posts?per_page=100&categories_exclude=${ignoreCategoryId}`;
      const fetchquery = `${wordPressApiUrl}posts?per_page=100&orderby=slug&order=asc`;
      const sourcefiles = await fetchJSON(fetchquery,undefined,fetchoutput);
      const totalpages = Number(fetchoutput.response.headers.get('x-wp-totalpages'));
      for(let currentpage = 2; currentpage<=totalpages; currentpage++)
        (await fetchJSON(`${fetchquery}&page=${currentpage}`)).forEach(x=>sourcefiles.push(x));

      return sourcefiles.map(sf=>({
        slug : sf.slug,
        id : sf.id,
        name : sf.name,
        filename : sf.slug,
        pagetitle : sf.title.rendered,
        meta : excerptToDescription(sf.excerpt.rendered),
        modified : sf.modified_gmt,
        content : sf.content.rendered,
        tags : defaultTags.concat(sf.tags.map(x=>taglist.find(y=>y.id===x).name)),
        category : sf.categories.length>0 ? categorylist.find(y=>y.id===sf.categories[0]).name : null
      }));
    };

    const manifest = {posts:[]};

    manifest.posts = await getWordPressPosts();

    //Add custom columns to sourcefile data
    manifest.posts.forEach(sourcefile => {
      const tagtext = sourcefile.tags.length===0 ? '' : `tags: [${sourcefile.tags.map(x=>`"${x}"`) .join(',')}]\n`;

      let content = sourcefile.content;

      sourcefile.isFragment = sourcefile.tags.includes(tag_fragment);
      sourcefile.isTableData = sourcefile.tags.includes(tag_table_data);
      sourcefile.addToSitemap = !sourcefile.tags.includes(tag_nocrawl); //do-not-crawl
      sourcefile.translate = sourcefile.tags.includes(tag_translate);
      sourcefile.ignore = sourcefile.tags.includes(tag_ignore); //do-not-deploy
      sourcefile.lang = (sourcefile.tags.find(x=>x.startsWith(tag_langprefix)) || tag_langprefix+tag_langdefault).replace(tag_langprefix,'');
      sourcefile.nomaster = sourcefile.tags.includes(tag_nomaster); //staging-only

      if (sourcefile.isTableData)
        sourcefile.html = JsonFromHtmlTables(content);
      else if (sourcefile.isFragment)
        sourcefile.html = content;
      else
        sourcefile.html = `---\nlayout: "page.njk"\ntitle: "${sourcefile.pagetitle}"\nmeta: "${sourcefile.meta}"\nauthor: "State of California"\npublishdate: "${sourcefile.modified}Z"\n${tagtext}addtositemap: ${sourcefile.addToSitemap}\n---\n${content}`;
    });

    for(const mergetarget of mergetargets) {
      //Query GitHub files
      const targetfiles = (await gitRepo.getContents(mergetarget,githubSyncFolder,false)).data
        .filter(x=>x.type==='file'&&(x.name.endsWith('.html')||x.name.endsWith('.json'))&&!ignoreFiles.includes(x.name));

      //Add custom columns to targetfile data
      targetfiles.forEach(x=>{
        //just get the filename, special characters and all
        x.filename = x.url.split(`${githubSyncFolder}/`)[1].split('.')[0].toLowerCase();
      });

      //Files to delete
      for(const deleteTarget of targetfiles.filter(x=>!manifest.posts.find(y=>x.filename===y.filename))) {
        await gitRepo.deleteFile(mergetarget,deleteTarget.path);
        console.log(`DELETE Success: ${deleteTarget.path}`);
        delete_count++;
      }

      //ADD/UPDATE
      for(const sourcefile of manifest.posts) {
        if(sourcefile.ignore) {
          console.log(`Ignored: ${sourcefile.filename}`);
          ignore_count++;
        } else if(sourcefile.nomaster&&mergetarget===masterbranch) {
          console.log(`PAGE Skipped: ${sourcefile.filename} -> ${mergetarget}`);
          staging_only_count++;
        } else {
          let targetfile = targetfiles.find(y=>sourcefile.filename===y.filename);
          const content = Buffer.from(sourcefile.html).toString('base64');
          const mysha = sha1(sourcefile.html);

          if(targetfile) {
            //UPDATE

            if(shamatch(mysha, targetfile.sha, sourcefile.slug, sourcefile.modified)) {
              console.log(`SHA matched: ${sourcefile.filename}`);
              shaupdate(sourcefile, mysha, targetfile.sha);
              sha_match_count++;
            } else {
              //compare
              targetfile = (await gitRepo.getContents(mergetarget,targetfile.path,false)).data; //reload the meta so we update the latest
              //const targetcontent = Buffer.from(targetfile.content,'base64').toString();
              const targetcontent = targetfile.content.replace(/\n/g,'');
              if(content!==targetcontent) {
                //Update file
                const message = gitHubMessage('Update page',targetfile.name);
                await gitRepo.writeFile(mergetarget, targetfile.path, content, message, {committer,encode:false},
                  (_a,results) => {
                    shaupdate(sourcefile, mysha, results.content.sha);
                  }
                );

                console.log(`UPDATE Success: ${sourcefile.filename}`);
                update_count++;

                if(mergetarget===masterbranch) {
                  translationUpdateAddPost(sourcefile, `/${mergetarget}/${targetfile.path}`,translationUpdatePayload);
                }
              } else {
                console.log(`File compare matched: ${sourcefile.filename}`);
                shaupdate(sourcefile, mysha, targetfile.sha);

                binary_match_count++;
              }
            }
          } else {
            //ADD
            const newFileName = `${sourcefile.filename}.${sourcefile.isTableData ? 'json' : 'html'}`;
            const newFilePath = `${githubSyncFolder}/${newFileName}`;
            const message = gitHubMessage('Add page',newFileName);
            await gitRepo.writeFile(mergetarget, newFilePath, content, message, {committer,encode:false},
              (_a,results) => {
                shaupdate(sourcefile, mysha, results.content.sha);
              }
            );

            console.log(`ADD Success: ${sourcefile.filename}`);
            add_count++;

            if(mergetarget===masterbranch) {
              translationUpdateAddPost(sourcefile, `/${mergetarget}/${newFilePath}`,translationUpdatePayload);
            }
          }
        }
      }
    }

    //Add to log
    const total_changes = add_count+update_count+delete_count;
    const log = {
      sourcebranch: masterbranch,
      runtime: `${started} to ${getPacificTimeNow()}`
    };

    if(req.method==="GET") log.method = req.method;
    if(binary_match_count>0) log.binary_match_count = binary_match_count;
    if(sha_match_count>0) log.sha_match_count = sha_match_count;
    if(add_count>0) log.add_count = add_count;
    if(update_count>0) log.update_count = update_count;
    if(delete_count>0) log.delete_count = delete_count;
    if(ignore_count>0) log.ignore_count = ignore_count;
    if(staging_only_count>0) log.staging_only_count = staging_only_count;
    if(total_changes>0) log.total_changes = total_changes;
    if(translationUpdatePayload.length>0) log.translationUpdatePayload = translationUpdatePayload;
    if(req.body) log.RequestBody = req.body;

    pinghistory.unshift(log);


    context.res = {
      body: {pinghistory},
      headers: {
        'Content-Type' : 'application/json'
      }
    };

    if(postTranslationUpdates&&translationUpdatePayload.length) {
      await postTranslations(translationUpdatePayload);
    }

    console.log('done.');
  } // End Try for the entire module
  catch (e) {
    //some error in the app.  Report it to slack.
    const errorTitle = `Problem running ${appName}`;
    await slackBotReportError(slackErrorChannel,errorTitle,e,req);

    context.res = {
      body: `<html><title>${errorTitle}</title><body><h1>${errorTitle}</h1><h2>Error Text</h2><pre>${e.stack}</pre><h2>Original Request</h2><pre>${JSON.stringify(req,null,2)}</pre></body></html>`,
      status: 500,
      headers: {
        'Content-Type' : 'text/html'
      }
    };
  }
  context.done();
};

const getPacificTimeNow = () => {
  let usaTime = new Date().toLocaleString("en-US", {timeZone: "America/Los_Angeles"});
  usaTime = new Date(usaTime);
  return usaTime.toLocaleString();
};

const JsonFromHtmlTables = html => {
  const data = {};

  JSDOM.fragment(html).querySelectorAll('table').forEach((table,tableindex) => {
    const rows = [];

    const headers = Array.prototype.map.call(table.querySelectorAll('thead tr th'),x => x.innerHTML);

    table.querySelectorAll('tbody tr').forEach(target => {
      const rowdata = {};
      target.childNodes.forEach(
        (x,i)=> {
          rowdata[headers[i]] = x
            .innerHTML
            .replace(/–en\./g,'--en.'); //remove stupid wordpress double dash replacements
        });
      rows.push(rowdata);
    });

    data[`Table${tableindex+1}`] = rows;
  });

  return JSON.stringify(data,null,2);
};
