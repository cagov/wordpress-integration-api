const fetch = require('node-fetch');
const { JSDOM } = require("jsdom");
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

const committer = {
    'name': 'WordPressService',
    'email': 'data@alpha.ca.gov'
};

const masterbranch='synctest3', stagingbranch='synctest3_staging', postTranslationUpdates = false, branchprefix = 'synctest3_deploy_';
//const masterbranch='master', stagingbranch='staging', postTranslationUpdates = true, branchprefix = 'wpservice_deploy_';
const autoApproveTranslationPrs = true;
const mergetargets = [masterbranch,stagingbranch];
const appName = 'WordPressService';
const githubUser = 'cagov';
const githubRepo = 'covid19';
const githubApiUrl = `https://api.github.com/repos/${githubUser}/${githubRepo}/`;
const githubTranslationPingsPath = `pages/translations/pings`;
const githubTranslationContentPath = `pages/translations/content`;
const githubTranslationFlatPath = `pages/translated-posts`;
const githubSyncFolder = 'pages/wordpress-posts'; //no slash at the end
const wordPressUrl = 'https://as-go-covid19-d-001.azurewebsites.net';
const wordPressApiUrl = `${wordPressUrl}/wp-json/wp/v2/`;
const translationUpdateEndpointUrl = 'https://workflow.avant.tools/subscribers/xtm';
const translationDownloadUrl = `https://storage.googleapis.com/covid19-ca-files-avantpage/`;
const translatedLanguages = [
    {code:'ar_AA',tag:'lang-ar',slugpostfix:'ar'},
    {code:'es_US',tag:'lang-es',slugpostfix:'es'},
    {code:'ko_KR',tag:'lang-ko',slugpostfix:'ko'},
    {code:'tl_PH',tag:'lang-tl',slugpostfix:'tl'},
    {code:'vi_VN',tag:'lang-vi',slugpostfix:'vi'},
    {code:'zh_TW',tag:'lang-zh-Hant',slugpostfix:'zh-hant'},
    {code:'zh_CN',tag:'lang-zh-Hans',slugpostfix:'zh-hans'}
];
const defaultTags = [];
const ignoreFiles = []; //No longer needed since manual-content folder used.
const githubApiContents = 'contents/';
const githubApiMerges = 'merges';
const tag_ignore = 'do-not-deploy';
const tag_translate = 'translate';
const tag_translatepriority = 'translate-priority';
const tag_fragment = 'fragment';
const tag_table_data = 'table-data';
const tag_nocrawl = 'do-not-crawl';
const tag_langprefix = 'lang-';
const tag_langdefault = 'en';
const tag_nomaster = 'staging-only';
const TranslationPrLabels = ['Translated Content'];

module.exports = async function (context, req) {

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
let add_count = 0, update_count = 0, delete_count = 0, binary_match_count = 0, sha_match_count = 0, ignore_count = 0, staging_only_count = 0, translation_pings_count = 0, translation_files_count = 0;

//Translation Update
const translationUpdatePayload = [];
const translationUpdateAddPost = (Post, download_path) => {
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

//Common Fetch functions
const fetchJSON = async (URL, options, fetchoutput) => 
    await fetch(URL,options)
    .then(response => {
        if (fetchoutput)
            fetchoutput.response = response;
        return response;
    })
    .then(response =>
        response.ok
        ? (
            response.status===200||response.status===201
            ? response.json()
            : null)
        : (
            response.status===404
            ? []
            : Promise.reject(response))
       )
    .catch(async response => {
        const json = (await (response.json ? response.json() : null)) || response;

        if(!options)
            options = {method:'GET'};

        context.res = {
            status: 500,
            body: `fetchJSON error - ${options.method} - ${URL} : ${JSON.stringify(json)}`
        };
        console.error(context.res.body);
        context.done();

        return Promise.reject(context.res.body);
    });

//Common function for creating a PUT option
const getPutOptions = bodyJSON =>
    ({
        method: 'PUT',
        headers: authheader(),
        body: JSON.stringify(bodyJSON)
    });

const branchGetHeadUrl = branch => `${githubApiUrl}git/refs/heads/${branch}`;

//Return a branch head record
const branchGetHead = async branch =>
    fetchJSON(branchGetHeadUrl(branch),defaultoptions());

//create a branch for this update
const branchCreate = async (filename,mergetarget) => {
    const branch = mergetarget + branchprefix + filename;
    const branchGetResult = await branchGetHead(mergetarget);
    const sha = branchGetResult.object.sha;

    const branchCreateBody = {
        method: 'POST',
        headers: authheader(),
        body: JSON.stringify({
            committer,
            ref: `refs/heads/${branch}`,
            sha
        })
    };

    await branchDelete(branch); //in case the branch was never cleaned up

    await fetchJSON(`${githubApiUrl}git/refs`, branchCreateBody)
        .then(() => {console.log(`BRANCH CREATE Success: ${branch}`); });

    return branch;
}

//merge and delete branch
const branchMerge = async (branch, mergetarget, bPrMode, PrTitle, PrLabels) => {

    if(!bPrMode) {
        //just merge and delete
        //merge
        //https://developer.github.com/v3/repos/merging/#merge-a-branch
        const mergeOptions = {
            method: 'POST',
            headers: authheader(),
            body: JSON.stringify({
                committer,
                base: mergetarget,
                head: branch,
                commit_message: `Deploy to ${mergetarget}\n${branch}`
            })
        };

        await fetchJSON(`${githubApiUrl}${githubApiMerges}`, mergeOptions)
            .then(() => {console.log(`MERGE Success: ${branch} -> ${mergetarget}`);});
        //End Merge

        await branchDelete(branch);
    } else {
        //create a pull request
        //https://developer.github.com/v3/pulls/#create-a-pull-request
        const githubApiPulls = 'pulls';
        const prbody = {
            method: 'POST',
            headers: authheader(),
            body: JSON.stringify({
                committer,
                base: mergetarget,
                head: branch,
                title: PrTitle
                //body: PrBody
                //,draft: bKeepPrOpen
            })
        };

        const PrResult = await fetchJSON(`${githubApiUrl}${githubApiPulls}`, prbody)
            .then(r => {
                console.log(`PR create Success`);
                return r;
            });

        //add labels to PR
        //https://developer.github.com/v3/issues/labels/#add-labels-to-an-issue
        if(PrLabels) {
            const prlabelbody = {
                method: 'POST',
                headers: authheader(),
                body: JSON.stringify({
                    labels: PrLabels
                })
            };

            const issue_number = PrResult.number;
    
            const PrLabelResult = await fetchJSON(`${githubApiUrl}issues/${issue_number}/labels`, prlabelbody)
            .then(r => {
                console.log(`PR Label Success`);
                return r;
            });
        }

        if(autoApproveTranslationPrs) {
            //Auto Merge PR
            //https://developer.github.com/v3/pulls/#merge-a-pull-request
            //Merge method to use. Possible values are merge, squash or rebase. Default is merge.
            const prsha = PrResult.head.sha;
            const prurl = PrResult.url;
            
            const prmergebody = {
                method: 'PUT',
                headers: authheader(),
                body: JSON.stringify({
                    committer,
                    //commit_title: 'PR merge commit title',
                    //commit_message: 'PR merge commit message',
                    sha: prsha,
                    merge_method: 'squash'
                })
            };

            const PrMergeResult = await fetchJSON(`${prurl}/merge`, prmergebody)
            .then(r => {
                    console.log(`PR MERGE Success`);
                    return r;
                });

            await branchDelete(branch);
        }
    }
}

const branchDelete = async branch => {
    //delete
    //https://developer.github.com/v3/git/refs/#delete-a-reference
    const deleteBody = {
        method: 'DELETE',
        headers: authheader()
    };
    const branchDeleteResult = await fetch(branchGetHeadUrl(branch), deleteBody);

    if(branchDeleteResult.status===204) {
        console.log(`BRANCH DELETE Success: ${branch}`);
    } else {
        console.log(`BRANCH DELETE N/A: ${branch}`);
    }
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
    const targetfiles = (await fetchJSON(`${githubApiUrl}${githubApiContents}${githubSyncFolder}?ref=${mergetarget}`,defaultoptions()))
        .filter(x=>x.type==='file'&&(x.name.endsWith('.html')||x.name.endsWith('.json'))&&!ignoreFiles.includes(x.name)); 

    //Add custom columns to targetfile data
    targetfiles.forEach(x=>{
        //just get the filename, special characters and all
        x.filename = x.url.split(`${githubApiUrl}${githubApiContents}${githubSyncFolder}/`)[1].split('.')[0].toLowerCase();
    });


    //Files to delete
    for(const deleteTarget of targetfiles.filter(x=>!manifest.posts.find(y=>x.filename===y.filename))) {
        const branch = await branchCreate(deleteTarget.filename,mergetarget);
        const message = gitHubMessage('Delete page',deleteTarget.name);
        const options = {
            method: 'DELETE',
            headers: authheader(),
            body: JSON.stringify({
                message,
                committer,
                branch,
                sha: deleteTarget.sha
            })
        };

        await fetchJSON(deleteTarget.url, options)
            .then(() => {console.log(`DELETE Success: ${deleteTarget.path}`);delete_count++;})

        await branchMerge(branch,mergetarget);
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

            let body = {
                committer,
                content
            };

            if(targetfile) {
                //UPDATE
                
                if(shamatch(mysha, targetfile.sha, sourcefile.slug, sourcefile.modified)) {
                    console.log(`SHA matched: ${sourcefile.filename}`);
                    shaupdate(sourcefile, mysha, targetfile.sha);
                    sha_match_count++;
                } else {
                    //compare
                    const targetcontent = await fetchJSON(`${githubApiUrl}git/blobs/${targetfile.sha}`,defaultoptions())
                    
                    if(content!==targetcontent.content.replace(/\n/g,'')) {
                        //Update file
                        body.message=gitHubMessage('Update page',targetfile.name);
                        body.sha=targetfile.sha;
                        body.branch = await branchCreate(sourcefile.slug, mergetarget);

                        const updateResult = await fetchJSON(targetfile.url, getPutOptions(body))
                            .then(r => {
                                console.log(`UPDATE Success: ${sourcefile.filename}`);
                                return r;
                            });
                        update_count++;
                        await branchMerge(body.branch, mergetarget);
                        
                        shaupdate(sourcefile, mysha, updateResult.content.sha);
                        if(mergetarget===masterbranch) {
                            translationUpdateAddPost(sourcefile, `/${mergetarget}/${targetfile.path}`);
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
                body.message=gitHubMessage('Add page',newFileName);
                body.branch = await branchCreate(sourcefile.slug, mergetarget);

                const addResult = await fetchJSON(`${githubApiUrl}${githubApiContents}${newFilePath}`, getPutOptions(body))
                    .then(r => {console.log(`ADD Success: ${sourcefile.filename}`);return r;})

                add_count++;
                await branchMerge(body.branch, mergetarget);
                shaupdate(sourcefile, mysha, addResult.content.sha);
                if(mergetarget===masterbranch) {
                    translationUpdateAddPost(sourcefile, `/${mergetarget}/${newFilePath}`);
                }
            }
        }
    }
}





const getTranslatedPageData = html => {
    //clean up any input issues

    //remove arabic reverse (RTL override) if it is at the beginning
    while (html.charCodeAt(0)===8294) html=html.substring(1);

    return html.trimLeft();
}

//Add translation pings
const addTranslationPings = async () => {
    if(!req.body||req.headers['content-type']!=='application/json') return;

    for(const mergetarget of mergetargets) {

        const pingJSON = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

        const files_id = pingJSON.files_id;
        const newFileName = `ping-${files_id}-${new Date().getTime()}.json`;
        const newFilePath = `${githubTranslationPingsPath}/${newFileName}`;
        const branch = await branchCreate(`ping-${files_id}`,mergetarget);
        const pingbody = {
            committer,
            branch,
            message : gitHubMessage('Add translation ping',newFileName),
            content : Buffer.from(JSON.stringify(pingJSON,null,2)).toString('base64')
        };

        //,"test": 1    ---Optional to indicate a test request
        
        await fetchJSON(`${githubApiUrl}${githubApiContents}${newFilePath}`, getPutOptions(pingbody))
            .then(() => {console.log(`Add translation ping Success: ${newFileName}`);});
        translation_pings_count++;

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

                    const downloadContentName = `${slug}-${langRow.code}.html`;
                    const downloadFilePath = `${files_id}/${post_id}/${downloadContentName}`;
                    const downloadURL = `${translationDownloadUrl}${downloadFilePath}`;

                    const file = await fetch(downloadURL);
                    
                    if(file.status!==200) {
                        //Can't find the lang file
                        console.log(`FETCH FILE ERROR ${file.status} - ${downloadFilePath}`);
                    } else {
                        console.log(`processing...${downloadFilePath}`);
                        translation_files_count++;

                        const html = getTranslatedPageData(await file.text());

                        let contentString = '';
                        if(manifestrecord.isTableData)
                            contentString = JsonFromHtmlTables(html);
                        else if(manifestrecord.isFragment)
                            contentString = html;
                        else {
                            //replace the 'translate' tag with the correct lang tag

                            contentString = html.replace(/\"translate\"/,`\"translate\"\,\"${langRow.tag}\"`);
                        }
                        const content = Buffer.from(contentString).toString('base64');


                        const newContentName = `${newslug}.${manifestrecord.isTableData ? 'json' : 'html'}`;
                        const newContentPath = `${githubTranslationContentPath}/${files_id}/${post_id}/${newContentName}?ref=${branch}`;
        
                        const filebody = {
                            committer,
                            branch,
                            message : gitHubMessage('Add translation content',newContentName),
                            content
                        };
        
                        const putResult = await fetch(`${githubApiUrl}${githubApiContents}${newContentPath}`, getPutOptions(filebody));
        
                        console.log(
                            putResult.ok
                            ? `Add translation content Success: ${newContentName}`
                            : `Add translation content Error: ${newContentName} - ${JSON.stringify(putResult.statusText)}`
                        );

                        const newURL = `${githubApiUrl}${githubApiContents}${githubTranslationFlatPath}/${newContentName}?ref=${branch}`;

                        const existingFileResponse = await fetch(newURL,defaultoptions())

                        if(existingFileResponse.ok) {
                            //update
                            const json = await existingFileResponse.json();

                            const updatebody = {
                                committer,
                                branch,
                                content,
                                message:gitHubMessage('Update translation',newContentName) + `\nSource : ${downloadURL}`,
                                sha:json.sha
                            };
        
                            await fetchJSON(json.url, getPutOptions(updatebody));
                            console.log(`UPDATE Success: ${newContentName}`);
                        } else {
                            //new
                            const addbody = {
                                committer,
                                branch,
                                content,
                                message:gitHubMessage('Add translation',newContentName) + `\nSource : ${downloadURL}`
                            };
                            
                            await fetchJSON(newURL, getPutOptions(addbody));
                            console.log(`ADD Success: ${newContentName}`);
                        }
                    }
                }
            }
        }

        await branchMerge(
            branch,
            mergetarget,
            mergetarget===masterbranch,
            `Translation - ${sourceFiles.join(`, `)}`,
            TranslationPrLabels
            );
    } //for
}
await addTranslationPings();

//Add to log
const total_changes = add_count+update_count+delete_count+translation_pings_count+translation_files_count;
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
if(translation_pings_count>0) log.translation_pings_count = translation_pings_count;
if(translation_files_count>0) log.translation_files_count = translation_files_count;
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

    if(postTranslationUpdates&&translationUpdatePayload.length>0) {
        const postTranslationOptions = {
            method: 'POST',
            body: JSON.stringify({posts:translationUpdatePayload})
        };
        await fetch(translationUpdateEndpointUrl, postTranslationOptions)
            .then(() => {console.log(`Translation Update POST Success`);})
    }

    console.log('done.');
    context.done();
}

const getPacificTimeNow = () => {
    let usaTime = new Date().toLocaleString("en-US", {timeZone: "America/Los_Angeles"});
    usaTime = new Date(usaTime);
    return usaTime.toLocaleString();
};

const authheader = () => ({
    'Authorization' : `Bearer ${process.env["GITHUB_TOKEN"]}`,
    'Content-Type': 'application/json'
});

const defaultoptions = () => ({method: 'GET', headers:authheader() });

const gitHubMessage = (action, file) => `${action} - ${file}`;

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
