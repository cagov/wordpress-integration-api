const { fetchJSON } = require('./fetchJSON');
const {
    gitHubMessage,
    gitHubBranchCreate,
    gitHubBranchMerge,
    gitHubFileDelete,
    gitHubFileUpdate,
    gitHubFileAdd,
    gitHubFileGet,
    gitHubFileGetBlob
} = require('./gitHub');
const {
    addTranslationPings,
    postTranslations,
    translationUpdateAddPost
} = require('./avantPage');

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
}
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

module.exports = async function (context, req) {

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

const branchCreate_WithName = async (filename,mergetarget) => {
    const branch = mergetarget + '_wpservice_deploy_' + filename;
    await gitHubBranchCreate(branch,mergetarget);
    return branch;
}

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
}

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
    sourcefile.lang = (sourcefile.tags.find(x=>x.startsWith(tag_langprefix)) || (tag_langprefix+tag_langdefault)).replace(tag_langprefix,'');
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
    const targetfiles = (await gitHubFileGet(githubSyncFolder,mergetarget))
        .filter(x=>x.type==='file'&&(x.name.endsWith('.html')||x.name.endsWith('.json'))&&!ignoreFiles.includes(x.name)); 

    //Add custom columns to targetfile data
    targetfiles.forEach(x=>{
        //just get the filename, special characters and all
        x.filename = x.url.split(`${githubSyncFolder}/`)[1].split('.')[0].toLowerCase();
    });

    //Files to delete
    for(const deleteTarget of targetfiles.filter(x=>!manifest.posts.find(y=>x.filename===y.filename))) {
        const branch = await branchCreate_WithName(deleteTarget.filename,mergetarget);
        const message = gitHubMessage('Delete page',deleteTarget.name);

        await gitHubFileDelete(deleteTarget.url, deleteTarget.sha, message, branch)
            .then(() => {console.log(`DELETE Success: ${deleteTarget.path}`);delete_count++;})

        await gitHubBranchMerge(branch,mergetarget);
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
            const targetfile = targetfiles.find(y=>sourcefile.filename===y.filename);
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
                    const targetcontent = await gitHubFileGetBlob(targetfile.sha);
                    
                    if(content!==targetcontent.content.replace(/\n/g,'')) {
                        //Update file
                        const message = gitHubMessage('Update page',targetfile.name);
                        const branch = await branchCreate_WithName(sourcefile.slug, mergetarget);
                        const updateResult = await gitHubFileUpdate(content,targetfile.url,targetfile.sha,message,branch)
                            .then(r => {
                                console.log(`UPDATE Success: ${sourcefile.filename}`);
                                return r;
                            });
                        update_count++;
                        await gitHubBranchMerge(branch, mergetarget);
                        
                        shaupdate(sourcefile, mysha, updateResult.content.sha);
                        if(mergetarget===masterbranch) {
                            translationUpdateAddPost(sourcefile, `/${mergetarget}/${targetfile.path}`,translationUpdatePayload);
                        }
                    } else {
                        console.log(`File compare matched: ${sourcefile.filename}`);
                        shaupdate(sourcefile, mysha, targetcontent.sha);

                        binary_match_count++;
                    }
                }
            } else {
                //ADD
                const newFileName = `${sourcefile.filename}.${sourcefile.isTableData ? 'json' : 'html'}`;
                const newFilePath = `${githubSyncFolder}/${newFileName}`;
                const message = gitHubMessage('Add page',newFileName);
                const branch = await branchCreate_WithName(sourcefile.slug, mergetarget);

                const addResult = await gitHubFileAdd(content,newFilePath,message,branch)
                    .then(r => {console.log(`ADD Success: ${sourcefile.filename}`);return r;})

                add_count++;
                await gitHubBranchMerge(branch, mergetarget);
                shaupdate(sourcefile, mysha, addResult.content.sha);
                if(mergetarget===masterbranch) {
                    translationUpdateAddPost(sourcefile, `/${mergetarget}/${newFilePath}`,translationUpdatePayload);
                }
            }
        }
    }
}

await addTranslationPings(manifest,mergetargets,req);

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
    context.done();
}

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
        target.childNodes.forEach((x,i)=>rowdata[headers[i]] = x.innerHTML);
        rows.push(rowdata);
      });
  
      data[`Table${tableindex+1}`] = rows;
    });
  
    return JSON.stringify(data,null,2);
};
