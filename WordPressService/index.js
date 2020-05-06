const fetch = require('node-fetch');
const { JSDOM } = require("jsdom");
const sha1 = require('sha1');

let pinghistory = []; //Used to log updates

const committer = {
    'name': 'WordPressService',
    'email': 'data@alpha.ca.gov'
};

//const branch = 'synctest3-wordpress-sync', sourcebranch='synctest3', mergetargets = [sourcebranch,'synctest3_staging'], postTranslationUpdates = false;
const branch = 'master-wordpress-sync', sourcebranch='master', mergetargets = [sourcebranch,'staging'], postTranslationUpdates = true;

const githubUser = 'cagov';
const githubRepo = 'covid19';
const githubApiUrl = `https://api.github.com/repos/${githubUser}/${githubRepo}/`;
const githubRawUrl = `https://raw.githubusercontent.com/${githubUser}/${githubRepo}/${branch}`;
const githubManifestPath = `pages/_data/wp/syncmanifest.json`;
const githubTranslationPingsPath = `pages/translations/pings`;
const githubTranslationContentPath = `pages/translations/content`;
const githubTranslationFlatPath = `pages/translated-posts`;
const githubSyncFolder = 'pages/wordpress-posts'; //no slash at the end
const githubImagesTargetFolder = 'src/img'; //no slash at the end
const wpTargetFilePrefix = '/wp';
const githubImagesCheckFolder = `${githubImagesTargetFolder}${wpTargetFilePrefix}`; //no slash at the end
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
const githubApiBranches = 'branches/';
const tag_ignore = 'do-not-deploy';
const tag_translate = 'translate';
const tag_translatepriority = 'translate-priority';
const tag_fragment = 'fragment';
const tag_table_data = 'table-data';
const tag_nocrawl = 'do-not-crawl';
const tag_langprefix = 'lang-';
const tag_langdefault = 'en';

module.exports = async function (context, req) {
//Logging data
const started = getPacificTimeNow();
let add_count = 0, update_count = 0, delete_count = 0, binary_match_count = 0, sha_match_count = 0, attachment_add_count = 0, attachment_delete_count = 0, attachments_used_count = 0, ignore_count = 0;

//Translation Update
const translationUpdatePayload = [];
const translationUpdateAddPost = Post => {
    if(Post.translate) {
        //Send pages marked "translate"
        const translationRow = {id : Post.id, slug : Post.slug, modified : Post.modified};

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

const WorkBranchIsSynced = async () => {
    const workbranchresult = await fetchJSON(`${githubApiUrl}${githubApiBranches}${branch}`,defaultoptions());
    const sourcebranchresult = await fetchJSON(`${githubApiUrl}${githubApiBranches}${sourcebranch}`,defaultoptions());

    return workbranchresult.commit.commit.tree.sha===sourcebranchresult.commit.commit.tree.sha;
}

//Prepare the work branch
const prepareWorkBranch = async () => {
    //see if the work and source branch are already lined up

    if(await WorkBranchIsSynced()) {
        //workbranch and sourcebranch match...no merge needed
        console.log(`MERGE Skipped: ${branch} matches ${sourcebranch}`)
    } else {
        //Merge
        const mergeOptions = {
            method: 'POST',
            headers: authheader(),
            body: JSON.stringify({
                committer,
                base: branch,
                head: sourcebranch,
                commit_message: `Synced from '${sourcebranch}'`
            })
        };

        await fetchJSON(`${githubApiUrl}${githubApiMerges}`, mergeOptions)
            .then(() => {console.log(`MERGE Success: ${branch} from ${sourcebranch}`);})
        //End Merge
    }
};
await prepareWorkBranch();

const shamatch = (wp_sha, github_sha, wp_slug, wp_modified) => 
    manifest.shadabase.find(x=>x.wp_sha===wp_sha&&x.github_sha===github_sha&&x.slug===wp_slug&&x.modified===wp_modified);

//load the manifest from github and create the shadabase from the saved post/media data
const manifest = (await fetchJSON(`${githubRawUrl}/${githubManifestPath}`,defaultoptions())) || {};
manifest.shadabase = [];

const shalink = file => {
    if(file.wp_sha&&file.github_sha&&!shamatch(file.wp_sha, file.github_sha, file.slug, file.modified))
    manifest.shadabase.push({wp_sha:file.wp_sha, github_sha:file.github_sha, slug:file.slug, modified:file.modified});
}

//shadabase is built with sha data from posts/media
await manifest.media.forEach(x=> {shalink(x)});
await manifest.posts.forEach(x=> {shalink(x)});

const shaslugmodifiedmatch = media => 
    manifest.shadabase.find(x=>x.slug===media.slug&&x.modified===media.modified);

//set the sha values in a file record
const shaupdate = (file, wp_sha, github_sha) => {
    file.wp_sha = wp_sha;
    file.github_sha = github_sha;
}

const loadMedia = async () => {
    //List of WP attachments
    const sourceAttachments = await fetchJSON(`${wordPressApiUrl}media?context=view&per_page=100&orderby=slug&order=asc`)

    //List of individual WP attachment sized
    manifest.media = [];
    for (const sourceAttachment of sourceAttachments)
        for (const sizename of sourceAttachment.media_type==='image' ? Object.keys(sourceAttachment.media_details.sizes) : [null]) {
            const newmedia = sizename ? sourceAttachment.media_details.sizes[sizename] : sourceAttachment;


            if (!newmedia.file)
                newmedia.file = `${newmedia.slug}.${newmedia.source_url.split('.').pop()}`
            
            manifest.media.push(
                {
                    slug : newmedia.slug || sourceAttachment.slug,
                    file : newmedia.file,
                    id : newmedia.id || sourceAttachment.id,
                    modified : newmedia.modified || sourceAttachment.modified,
                    wp_path : newmedia.source_url,
                     //flatten the file path
                    github_path : `${githubImagesTargetFolder}${wpTargetFilePrefix}/${newmedia.file}`,
                    mime_type : newmedia.mime_type
                }
            );
        }
}

await loadMedia();

//List of WP categories
const categorylist = (await fetchJSON(`${wordPressApiUrl}categories?context=embed&hide_empty=true&per_page=100&orderby=slug&order=asc`))
    .map(x=>({id:x.id,name:x.name}));

//List of WP Tags
const taglist = (await fetchJSON(`${wordPressApiUrl}tags?context=embed&hide_empty=true&per_page=100&orderby=slug&order=asc`))
    .map(x=>({id:x.id,name:x.name}));

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
        meta : sf.excerpt.rendered.replace(/<p>/,'').replace(/<\/p>/,'').replace(/\n/,'').trim(),
        modified : sf.modified_gmt,
        content : sf.content.rendered,
        tags : defaultTags.concat(sf.tags.map(x=>taglist.find(y=>y.id===x).name)),
        category : sf.categories.length>0 ? categorylist.find(y=>y.id===sf.categories[0]).name : null
    }));
}

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

    //if there are attachments, fix the links
    if(!sourcefile.isTableData) 
        for (const filesize of manifest.media) {
            const newUrl = filesize.github_path.replace(/^src/,'');
            const setused = () => {
                filesize.usedbyslugs = filesize.usedbyslugs || [];
                filesize.usedbyslugs.push(sourcefile.slug);
                attachments_used_count++;
            }
            if(content.match(newUrl)) {
                setused();
            }
            if(content.match(filesize.wp_path)) {
                content = content.replace(new RegExp(filesize.wp_path, 'g'),newUrl);
                setused();
            }
        }

    if (sourcefile.isTableData)
        sourcefile.html = JsonFromHtmlTables(content);
    else if (sourcefile.isFragment)
        sourcefile.html = content;
    else 
        sourcefile.html = `---\nlayout: "page.njk"\ntitle: "${sourcefile.pagetitle}"\nmeta: "${sourcefile.meta}"\nauthor: "State of California"\npublishdate: "${sourcefile.modified}Z"\n${tagtext}addtositemap: ${sourcefile.addToSitemap}\n---\n${content}`;
});

//Lift of github attachments
const targetAttachmentFiles = await fetchJSON(`${githubApiUrl}${githubApiContents}${githubImagesCheckFolder}?ref=${branch}`,defaultoptions())

//Make sure all the attachment sizes get added
for (const sourceMedia of manifest.media) {
    if(sourceMedia.usedbyslugs) {
        const targetMedia = targetAttachmentFiles.find(x=>x.path===sourceMedia.github_path);

        if(targetMedia) {
            //File is used, and it exists in the repo
            const slugmodrow = shaslugmodifiedmatch(sourceMedia);

            if(slugmodrow) {
                //slug/modfied has not been modified
                console.log(`Media SLUG/modified MATCH: ${sourceMedia.file}`);
                shaupdate(sourceMedia, slugmodrow.wp_sha, slugmodrow.github_sha);
                sha_match_count++;
            } else {
                //binary compare
                const sourcefilebytes =  await fetch(`${wordPressUrl}${sourceMedia.wp_path}`);
                const sourcebuffer = await sourcefilebytes.arrayBuffer();
                const sourceBuffer = Buffer.from(sourcebuffer);
                const sourcesha = sha1(sourceBuffer);

                if(shamatch(sourcesha,targetMedia.sha, sourceMedia.slug, sourceMedia.modified)) {
                    console.log(`File SHA MATCH: ${sourceMedia.file}`);
                    shaupdate(sourceMedia, sourcesha, targetMedia.sha);
                    sha_match_count++;
                } else {
                    console.log(`File sha NO MATCH!!!: ${sourceMedia.file}`);

                    const targetfilebytes = await fetch(targetMedia.download_url,defaultoptions());
                    const targetbuffer = await targetfilebytes.arrayBuffer();
                    const targetBuffer = Buffer.from(targetbuffer);
            
                    if(targetBuffer.equals(sourceBuffer)) {
                        //files are the same...set sha to match
                        console.log(`File BINARY MATCH: ${sourceMedia.file}`);
                        shaupdate(sourceMedia, sourcesha, targetMedia.sha);
                        binary_match_count++;
                    } else {
                        //files differ...time to update
                        console.log(`File binary NO MATCH!!!...needs update: ${sourceMedia.file}`);            
                        let body = {
                            committer,
                            branch,
                            content : sourceBuffer.toString('base64'),
                            message : gitHubMessage('Update file',targetMedia.name),
                            sha : targetMedia.sha
                        };

                        const updateResult = await fetchJSON(targetMedia.url, getPutOptions(body))
                            .then(r => {
                                console.log(`UPDATE Success: ${sourceMedia.file}`);
                                return r;
                            });

                        shaupdate(sourceMedia, sourcesha, updateResult.content.sha);
                        
                        update_count++;
                    }
                }
            } //Binary Compare
        } else {
            //File is used, and it needs to be added to the repo
            const filebytes =  await fetch(`${wordPressUrl}${sourceMedia.wp_path}`);
            const buffer = await filebytes.arrayBuffer();
            const sourceBuffer = Buffer.from(buffer);
            const sourcesha = sha1(sourceBuffer);
            const content = sourceBuffer.toString('base64');
            const message = gitHubMessage('Add file',sourceMedia.file);

            const fileAddOptions = getPutOptions({
                message,
                committer,
                branch,
                content
            });
        
            const addresult = await fetchJSON(`${githubApiUrl}${githubApiContents}${sourceMedia.github_path}`, fileAddOptions)
                .then(r => {
                    console.log(`ATTACHMENT ADD Success: ${sourceMedia.file}`);
                    return r;
                });

            shaupdate(sourceMedia, sourcesha, addresult.content.sha);
            
            attachment_add_count++;
        }
    } else {
        //Not used...why is it in wordpress?
        console.log(`- Unused file in Wordpress: ${sourceMedia.file}`);
    }
}

//Remove extra attachment sizes
for (const targetAttachmentSize of targetAttachmentFiles)
    //If this file shouldn't be there, remove it
    if(!manifest.media.find(x=>targetAttachmentSize.path===x.github_path&&x.usedbyslugs)) {
        const message = gitHubMessage('Delete file',targetAttachmentSize.name);
        const options = {
            method: 'DELETE',
            headers: authheader(),
            body: JSON.stringify({
                message,
                committer,
                branch,
                "sha": targetAttachmentSize.sha
            })
        };

        await fetchJSON(targetAttachmentSize.url, options)
            .then(() => {console.log(`ATTACHMENT DELETE Success: ${targetAttachmentSize.name}`);attachment_delete_count++;})
    }


//Query GitHub files
const targetfiles = (await fetchJSON(`${githubApiUrl}${githubApiContents}${githubSyncFolder}?ref=${branch}`,defaultoptions()))
    .filter(x=>x.type==='file'&&(x.name.endsWith('.html')||x.name.endsWith('.json'))&&!ignoreFiles.includes(x.name)); 

//Add custom columns to targetfile data
targetfiles.forEach(x=>{
    //just get the filename, special characters and all
    x.filename = x.url.split(`${githubApiUrl}${githubApiContents}${githubSyncFolder}/`)[1].split('.')[0].toLowerCase();
});

//Files to delete
for(const deleteTarget of targetfiles.filter(x=>!manifest.posts.find(y=>x.filename===y.filename))) {
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
}

//ADD/UPDATE
for(const sourcefile of manifest.posts) {
    if(sourcefile.ignore) {
        console.log(`Ignored: ${sourcefile.filename}`);
        ignore_count++;
    } else {
        const targetfile = targetfiles.find(y=>sourcefile.filename===y.filename);
        const content = Buffer.from(sourcefile.html).toString('base64');
        const mysha = sha1(sourcefile.html);

        let body = {
            committer,
            branch,
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

                    const updateResult = await fetchJSON(targetfile.url, getPutOptions(body))
                        .then(r => {
                            console.log(`UPDATE Success: ${sourcefile.filename}`);
                            return r;
                        });
                    update_count++;
                    
                    shaupdate(sourcefile, mysha, updateResult.content.sha);
                    translationUpdateAddPost(sourcefile);
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
            
            const addResult = await fetchJSON(`${githubApiUrl}${githubApiContents}${newFilePath}`, getPutOptions(body))
                .then(r => {console.log(`ADD Success: ${sourcefile.filename}`);return r;})

            add_count++;
            shaupdate(sourcefile, mysha, addResult.content.sha);
            translationUpdateAddPost(sourcefile);
        }
    }
}

//Add translation pings
const addTranslationPings = async () => {
    if(!req.body||req.headers['content-type']!=='application/json') return;

    const newFileName = `ping-${new Date().getTime()}.json`;
    const newFilePath = `${githubTranslationPingsPath}/${newFileName}`;

    const pingbody = {
        committer,
        branch,
        message : gitHubMessage('Add translation ping',newFileName),
        content : Buffer.from(JSON.stringify(req.body,null,2)).toString('base64')
    };
    
    await fetchJSON(`${githubApiUrl}${githubApiContents}${newFilePath}`, getPutOptions(pingbody))
        .then(r => {console.log(`Add translation ping Success: ${newFileName}`);});

    const files_id = req.body.files_id;
    const translated_on = new Date(req.body.translated_on*1000);
    const posts = req.body.posts.map(x=>Number(x));

    if(!files_id||!translated_on||!posts) return;

    for(const post_id of posts) {
        const manifestrecord = manifest.posts.find(p=>p.id===post_id);

        if(manifestrecord) {
            const slug = manifestrecord.slug;

            for(const langRow of translatedLanguages) {
                const newslug = `${slug}-${langRow.slugpostfix}`;
                const title = newslug; //replace with real title

                const downloadContentName = `${slug}-${langRow.code}.html`;
                const downloadFilePath = `${files_id}/${post_id}/${downloadContentName}`;
                const file = await fetch(`${translationDownloadUrl}${downloadFilePath}`);
                
                if(file.status!==200) {
                    //Can't find the lang file
                    console.log(`FETCH FILE ERROR ${file.status} - ${downloadFilePath}`);
                } else {
                    const html = await file.text();

                    let contentString = '';
                    if(manifestrecord.isTableData)
                        contentString = JsonFromHtmlTables(html);
                    else if(manifestrecord.isFragment)
                        contentString = html;
                    else 
                        contentString = `---\nlayout: "page.njk"\ntitle: "${title}"\nmeta: ""\nauthor: "State of California"\npublishdate: "${translated_on.toISOString()}"\ntags: ["${langRow.tag}"]\naddtositemap: false\n---\n${html}`;
                    
                    content = Buffer.from(contentString).toString('base64');


                    const newContentName = `${newslug}.${manifestrecord.isTableData ? 'json' : 'html'}`;
                    const newContentPath = `${githubTranslationContentPath}/${files_id}/${post_id}/${newContentName}`;
    
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

                        let updatebody = {
                            committer,
                            branch,
                            content,
                            message:gitHubMessage('Update translation',newContentName),
                            sha:json.sha
                        };
    
                        await fetchJSON(json.url, getPutOptions(updatebody));
                        console.log(`UPDATE Success: ${newContentName}`);
                    } else {
                        //new
                        let addbody = {
                            committer,
                            branch,
                            content,
                            message:gitHubMessage('Add translation',newContentName)
                        };
                        
                        await fetchJSON(newURL, getPutOptions(addbody));
                        console.log(`ADD Success: ${newContentName}`);
                    }
                }
            }
        }
    }
}
await addTranslationPings();

//Add to log
const total_changes = add_count+update_count+delete_count+attachment_add_count+attachment_delete_count;
const log = {
    branch,
    started,
    completed: getPacificTimeNow(),
    ignore_count
};

if(req.method==="GET") log.method = req.method;
if(binary_match_count>0) log.binary_match_count = binary_match_count;
if(sha_match_count>0) log.sha_match_count = sha_match_count;
if(add_count>0) log.add_count = add_count;
if(update_count>0) log.update_count = update_count;
if(delete_count>0) log.delete_count = delete_count;
if(attachment_add_count>0) log.attachment_add_count = attachment_add_count;
if(attachment_delete_count>0) log.attachment_delete_count = attachment_delete_count;
if(attachments_used_count>0) log.attachments_used_count = attachments_used_count;
if(total_changes>0) log.total_changes = total_changes;
if(translationUpdatePayload.length>0) log.translationUpdatePayload = translationUpdatePayload;
if(req.body) log.RequestBody = req.body;

pinghistory.unshift(log);
//Branch done

const update_manifest = async () => {
    //don't need shadabase anymore
    delete manifest.shadabase;

    //Remove content from manifest
    manifest.posts.forEach(x=>{
        delete x.content;
        delete x.html;
        delete x.meta;
    });

    //get existing manifest for branch compare
    const currentmanifest = await fetchJSON(`${githubApiUrl}${githubApiContents}${githubManifestPath}?ref=${branch}`,defaultoptions())
    const content = Buffer.from(JSON.stringify(manifest,null,2)).toString('base64');

    if(!currentmanifest.content||content!==currentmanifest.content.replace(/\n/g,'')) {
        //manifest changed
        const body = {
            committer,
            branch,
            content,
            message:'Update manifest',
            sha:currentmanifest.sha
        };
        
        await fetchJSON(currentmanifest.url, getPutOptions(body))
            .then(() => {console.log(`Manifest UPDATE Success:`)});
    }
}
await update_manifest();

if(await WorkBranchIsSynced())
    console.log(`MERGE Skipped - No Changes`);
else {
    //Something changed..merge time (async, since we are done here.)
    mergetargets.forEach(async mergetarget =>  {
        //Merge
        const mergeOptions = {
            method: 'POST',
            headers: authheader(),
            body: JSON.stringify({
                committer,
                base: mergetarget,
                head: branch,
                //merge_method: 'squash',
                commit_message: `WordPressService deployed to '${mergetarget}'`
            })
        };

        await fetchJSON(`${githubApiUrl}${githubApiMerges}`, mergeOptions)
            .then(() => {console.log(`MERGE Success: ${mergetarget} from ${branch}`);})
        //End Merge
    });
}

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
