const fetch = require('node-fetch');
const { JSDOM } = require("jsdom");
const sha1 = require('sha1');

let pinghistory = []; //Used to log updates

const committer = {
    'name': 'WordPressService',
    'email': 'data@alpha.ca.gov'
};

const branch = 'synctest3-wordpress-sync', sourcebranch='synctest3', mergetargets = [sourcebranch,'synctest3_staging'];
//const branch = 'master-wordpress-sync', sourcebranch='master', mergetargets = [sourcebranch,'staging'];


const githubUser = 'cagov';
const githubRepo = 'covid19';
const githubApiUrl = `https://api.github.com/repos/${githubUser}/${githubRepo}/`;
const githubRawUrl = `https://raw.githubusercontent.com/${githubUser}/${githubRepo}/${branch}`;
const githubManifestPath = `pages/_data/wp/syncmanifest.json`;
const githubSyncFolder = 'pages/wordpress-posts'; //no slash at the end
const githubImagesTargetFolder = 'src/img'; //no slash at the end
const wpTargetFilePrefix = '/wp';
const githubImagesCheckFolder = `${githubImagesTargetFolder}${wpTargetFilePrefix}`; //no slash at the end
const wordPressUrl = 'https://as-go-covid19-d-001.azurewebsites.net';
const wordPressApiUrl = `${wordPressUrl}/wp-json/wp/v2/`;
const defaultTags = [];
const ignoreFiles = []; //No longer needed since manual-content folder used.
const githubApiContents = 'contents/';
const githubApiMerges = 'merges';
const githubApiBranches = 'branches/';
const tag_ignore = 'do-not-deploy';
const tag_fragment = 'fragment';
const tag_table_data = 'table-data';
const tag_nocrawl = 'do-not-crawl';

module.exports = async function (context, req) {
//Logging data
const started = getPacificTimeNow();
let add_count = 0, update_count = 0, delete_count = 0, binary_match_count = 0, sha_match_count = 0, attachment_add_count = 0, attachment_delete_count = 0, attachments_used_count = 0, ignore_count = 0;

//Common Fetch functions
const fetchJSON = async (URL, options, fetchoutput) => 
    await fetch(URL,options)
    .then(response => {
        if (fetchoutput)
            fetchoutput.response = response;
        return response;
    })
    .then(response => response.ok ? (response.status===200 ? response.json() : null) : Promise.reject(response))
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

//load the manifest from github
const manifest = await fetchJSON(`${githubRawUrl}/${githubManifestPath}`,defaultoptions());

await manifest.shadabase.forEach(x=>x.matchcount=0);

const shamatch = (wpsha, githubsha) => {
    const existing = manifest.shadabase.find(x=>x.wpsha===wpsha&&x.githubsha===githubsha);
    if(existing)
        existing.matchcount++;
    return existing
}
const shalink = (wpsha, githubsha) => {
    const existing=shamatch(wpsha, githubsha);
    if(existing)
        existing.matchcount++;
    else
        manifest.shadabase.push({wpsha, githubsha, matchcount:0});
}
//Lift of github attachments
const targetAttachmentFiles = await fetchJSON(`${githubApiUrl}${githubApiContents}${githubImagesCheckFolder}?ref=${branch}`,defaultoptions())

//List of WP attachments
const sourceAttachments = await fetchJSON(`${wordPressApiUrl}media?context=embed&per_page=100`)

//List of individual WP attachment sized
const sourceAttachmentSizes = [];
for (const sourceAttachment of sourceAttachments)
    for (const sizename of sourceAttachment.media_type==='image' ? Object.keys(sourceAttachment.media_details.sizes) : [null]) {
        const sourceAttachmentSize = sizename ? sourceAttachment.media_details.sizes[sizename] : sourceAttachment;


        if (!sourceAttachmentSize.file)
            sourceAttachmentSize.file = `${sourceAttachmentSize.slug}.${sourceAttachmentSize.source_url.split('.').pop()}`
        
        //flatten the file path
        sourceAttachmentSize.newpath = `${githubImagesTargetFolder}${wpTargetFilePrefix}/${sourceAttachmentSize.file}`;
        sourceAttachmentSizes.push(sourceAttachmentSize);
    }

//List of WP categories
const categories = (await fetchJSON(`${wordPressApiUrl}categories?context=embed&hide_empty=true&per_page=100`))
    .map(x=>({id:x.id,name:x.name}));

//List of WP Tags
const taglist = (await fetchJSON(`${wordPressApiUrl}tags?context=embed&hide_empty=true&per_page=100`))
    .map(x=>({id:x.id,name:x.name}));


//Query WP files
const getWordPressPosts = async () => {
    const fetchoutput = {};
    //const fetchquery = `${wordPressApiUrl}posts?per_page=100&categories_exclude=${ignoreCategoryId}`;
    const fetchquery = `${wordPressApiUrl}posts?per_page=100`;
    const sourcefiles = await fetchJSON(fetchquery,undefined,fetchoutput);
    const totalpages = Number(fetchoutput.response.headers.get('x-wp-totalpages'));
    for(let currentpage = 2; currentpage<=totalpages; currentpage++)
        (await fetchJSON(`${fetchquery}&page=${currentpage}`)).forEach(x=>sourcefiles.push(x));
    
    return sourcefiles;
}

const sourcefiles = await getWordPressPosts();

//Add custom columns to sourcefile data
sourcefiles.forEach(sourcefile => {
    sourcefile.filename = sourcefile.slug;

    const pagetitle = sourcefile.title.rendered;
    const meta = sourcefile.excerpt.rendered.replace(/<p>/,'').replace(/<\/p>/,'').replace(/\n/,'').trim();
    const matchedtags = defaultTags.concat(sourcefile.tags.map(x=>taglist.find(y=>y.id===x).name));

    const tagtext = matchedtags.length===0 ? '' : `tags: [${matchedtags.map(x=>`"${x}"`) .join(',')}]\n`;

    let content = sourcefile.content.rendered;

    sourcefile.tags = matchedtags;
    sourcefile.isFragment = matchedtags.includes(tag_fragment);
    sourcefile.isTableData = matchedtags.includes(tag_table_data);
    sourcefile.addToSitemap = !matchedtags.includes(tag_nocrawl);
    sourcefile.ignore = matchedtags.includes(tag_ignore); //do-not-deploy

    //if there are attachments, fix the links
    for (const filesize of sourceAttachmentSizes) {
        const newUrl = filesize.newpath.replace(/^src/,'');
        const setused = () => {
            filesize.usedbyslugs = filesize.usedbyslugs || [];
            filesize.usedbyslugs.push(sourcefile.slug);
            attachments_used_count++;
        }
        if(content.match(newUrl)) {
            setused();
        }
        if(content.match(filesize.source_url)) {
            content = content.replace(new RegExp(filesize.source_url, 'g'),newUrl);
            setused();
        }
    }

    if (sourcefile.isTableData)
        sourcefile.html = JsonFromHtmlTables(content);
    else if (sourcefile.isFragment)
        sourcefile.html = content;
    else 
        sourcefile.html = `---\nlayout: "page.njk"\ntitle: "${pagetitle}"\nmeta: "${meta}"\nauthor: "State of California"\npublishdate: "${sourcefile.modified_gmt}Z"\n${tagtext}addtositemap: ${sourcefile.addToSitemap}\n---\n${content}`;
});


//Make sure all the attachment sizes get added
for (const sourceAttachmentSize of sourceAttachmentSizes) {
    if(sourceAttachmentSize.usedbyslugs) {
        const targetAttachmentFile = targetAttachmentFiles.find(x=>x.path===sourceAttachmentSize.newpath);

        if(targetAttachmentFile) {
            //File is used, and it exists in the repo

            //binary compare
            const sourcefilebytes =  await fetch(`${wordPressUrl}${sourceAttachmentSize.source_url}`);
            const sourcebuffer = await sourcefilebytes.arrayBuffer();

            const targetfilebytes = await fetch(targetAttachmentFile.download_url,defaultoptions());
            const targetbuffer = await targetfilebytes.arrayBuffer();

            const targetBuffer = Buffer.from(targetbuffer);
            const sourceBuffer = Buffer.from(sourcebuffer);

            const sourcesha = sha1(sourceBuffer);
            const targetsha = sha1(targetBuffer);

            //const targetBase64 = targetBuffer.toString('base64');
            //const sourceBase64 = sourceBuffer.toString('base64');

            //TODO:
            //For now, if the size changes do an update?
            //Really need to keep a sync status file to store hashes.


            if(sourcesha!==targetsha) {
                //files differ...time to update
                console.log(`File binary NO MATCH!!!...needs update: ${sourceAttachmentSize.file}`);
            } else {
                //files are the same...set sha to match
                console.log(`File binary matched: ${sourceAttachmentSize.file}`);

            }






            //const targetcontent = await fetchJSON(`${githubApiUrl}git/blobs/${targetAttachmentFile.sha}`,defaultoptions())

const yo=1;
//check the GMT modification date and see if it is newer than the last update.  



        } else {
            //File is used, and it needs to be added to the repo
            const filebytes =  await fetch(`${wordPressUrl}${sourceAttachmentSize.source_url}`);
            const buffer = await filebytes.arrayBuffer();
            const content =  Buffer.from(buffer).toString('base64');
            const message = gitHubMessage('Add file',sourceAttachmentSize.file);

            const fileAddOptions = getPutOptions({
                message,
                committer,
                branch,
                content
            });
        
            await fetchJSON(`${githubApiUrl}${githubApiContents}${sourceAttachmentSize.newpath}`, fileAddOptions)
                .then(() => {console.log(`ATTACHMENT ADD Success: ${sourceAttachmentSize.file}`);attachment_add_count++;});
        }
    } else {
        //Not used...why is it in wordpress?
        console.log(`Unused file in Wordpress: ${sourceAttachmentSize.file}`);
    }
}

//Remove extra attachment sizes
for (const targetAttachmentSize of targetAttachmentFiles)
    //If this file shouldn't be there, remove it
    if(!sourceAttachmentSizes.find(x=>targetAttachmentSize.path===x.newpath&&x.usedbyslugs)) {
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
    x.filename = x.name.split('.')[0];
});

//Files to delete
for(const deleteTarget of targetfiles.filter(x=>!sourcefiles.find(y=>x.filename===y.filename))) {
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
for(const sourcefile of sourcefiles) {
    if(sourcefile.ignore) {
        console.log(`Ignored: ${sourcefile.filename}`);
        ignore_count++;
    } else {
        const targetfile = targetfiles.find(y=>sourcefile.filename===y.filename);
        const content = Buffer.from(sourcefile.html).toString('base64');

        let body = {
            committer,
            branch,
            content
        };

        if(targetfile) {
            //UPDATE
            const mysha = sha1(sourcefile.html);
            if(shamatch(mysha, targetfile.sha)) {
                console.log(`SHA matched: ${targetfile.path}`);
                sha_match_count++;
            } else {
                //compare
                const targetcontent = await fetchJSON(`${githubApiUrl}git/blobs/${targetfile.sha}`,defaultoptions())
                
                if(content!==targetcontent.content.replace(/\n/g,'')) {
                    //Update file
                    body.message=gitHubMessage('Update page',targetfile.name);
                    body.sha=targetfile.sha;

                    const result = await fetchJSON(targetfile.url, getPutOptions(body))
                        .then((r) => {console.log(`UPDATE Success: ${sourcefile.filename}`);update_count++;return r;})

                    //shalink(mysha, result.sha);
                } else {
                    console.log(`File compare matched: ${sourcefile.filename}`);
                    shalink(mysha, targetcontent.sha);
                    binary_match_count++;
                }
            }
        } else {
            //ADD
            const newFileName = `${sourcefile.filename}.${sourcefile.isTableData ? 'json' : 'html'}`;
            const newFilePath = `${githubSyncFolder}/${newFileName}`;
            body.message=gitHubMessage('Add page',newFileName);
            
            await fetchJSON(`${githubApiUrl}${githubApiContents}${newFilePath}`, getPutOptions(body))
                .then(() => {console.log(`ADD Success: ${sourcefile.filename}`);add_count++;})
        }
    }
}

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

pinghistory.unshift(log);
//Branch done






//Update manifest
const update_manifest = async () => {
    //sort shas
    manifest.shadabase.sort((a, b) => ('' + a.wpsha).localeCompare(b.wpsha));
    //Remove shas with no matches.
    manifest.shadabase = manifest.shadabase.filter(x=>x.matchcount);

    const currentmanifest = await fetchJSON(`${githubApiUrl}${githubApiContents}${githubManifestPath}?ref=${branch}`,defaultoptions())

    const body = {
        committer,
        branch,
        content:Buffer.from(JSON.stringify(manifest,null,2)).toString('base64'),
        message:'Update manifest',
        sha:currentmanifest.sha
    };
    
    await fetchJSON(currentmanifest.url, getPutOptions(body))
        .then(() => {console.log(`Manifest UPDATE Success:`)});
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

    console.log('done.');
    context.done();
}

function getPacificTimeNow() {
    let usaTime = new Date().toLocaleString("en-US", {timeZone: "America/Los_Angeles"});
    usaTime = new Date(usaTime);
    return usaTime.toLocaleString();
}

function authheader() {
    return {
        'Authorization' : `Bearer ${process.env["GITHUB_TOKEN"]}`,
        'Content-Type': 'application/json'
    };
}

function defaultoptions() {
    return {method: 'GET', headers:authheader() }
}

function gitHubMessage(action, file) {
    return `${action} - ${file}`;
}

function JsonFromHtmlTables(html) {    
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
}

