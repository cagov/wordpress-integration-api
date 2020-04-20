const fetch = require('node-fetch');
const { JSDOM } = require("jsdom");
const sha1 = require('sha1');

let pinghistory = []; //Used to log updates
let shadabase = {}; //Used to hold sha compare hashes for faster compares

const committer = {
    'name': 'WordPressService',
    'email': 'data@alpha.ca.gov'
};

const githubApiUrl = 'https://api.github.com/repos/cagov/covid19/';
const branch = 'master', githubMergeTarget = 'staging';
//const branch = 'synctest3', githubMergeTarget = 'synctest3_staging';

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

    //Lift of github attachments
    const targetAttachmentFiles = await fetch(`${githubApiUrl}${githubApiContents}${githubImagesCheckFolder}?ref=${branch}`,defaultoptions())
        .then(response => response.ok ? response.json() : []);

    //List of WP attachments
    const sourceAttachments = await fetchJSON(`${wordPressApiUrl}media?context=embed&per_page=100`)
        //.filter(x=>x.post)

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
    //const categories = (await fetchJSON(`${wordPressApiUrl}categories?context=embed&hide_empty=true&per_page=100`))
    //    .map(x=>({id:x.id,name:x.name,slug:x.slug}));

    //ID of category to ignore
    //const ignoreCategoryId = categories
    //    .find(x=>x.slug===tag_ignore).id;

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
        for (const filesize of sourceAttachmentSizes)
            if(content.match(filesize.source_url)) {
                content = content.replace(new RegExp(filesize.source_url, 'g'),filesize.newpath.replace(/^src/,''));
                filesize.used = true;
                attachments_used_count++;
            }

        if (sourcefile.isTableData)
            sourcefile.html = JsonFromHtmlTables(content);
        else if (sourcefile.isFragment)
            sourcefile.html = content;
        else 
            sourcefile.html = `---\nlayout: "page.njk"\ntitle: "${pagetitle}"\nmeta: "${meta}"\nauthor: "State of California"\npublishdate: "${sourcefile.modified_gmt}Z"\n${tagtext}addtositemap: ${sourcefile.addToSitemap}\n---\n${content}`;
    });

    
    //Make sure all the attachment sizes get added
    for (const sourceAttachmentSize of sourceAttachmentSizes)
        //If this attachment size was used, and isn't there, add it
        if(sourceAttachmentSize.used && !targetAttachmentFiles.find(x=>x.path===sourceAttachmentSize.newpath)) {
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

    //Remove extra attachment sizes
    for (const targetAttachmentSize of targetAttachmentFiles)
        //If this file shouldn't be there, remove it
        if(!sourceAttachmentSizes.find(x=>targetAttachmentSize.path===x.newpath&&x.used)) {
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
    
            await fetchJSON(`${githubApiUrl}${githubApiContents}${targetAttachmentSize.path}`, options)
                .then(() => {console.log(`ATTACHMENT DELETE Success: ${targetAttachmentSize.name}`);attachment_delete_count++;})
        }


    //Query GitHub files
    const targetfiles = (await fetchJSON(`${githubApiUrl}${githubApiContents}${githubSyncFolder}?ref=${branch}`,defaultoptions()))
        .filter(x=>x.type==='file'&&(x.name.endsWith('.html')||x.name.endsWith('.json'))&&!ignoreFiles.includes(x.name)); 

    //Add custom columns to targetfile data
    targetfiles.forEach(x=>x.filename=x.name.split('.')[0]);
    
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

        await fetchJSON(`${githubApiUrl}${githubApiContents}${deleteTarget.path}`, options)
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

                        await fetchJSON(`${githubApiUrl}${githubApiContents}${targetfile.path}`, getPutOptions(body))
                            .then(() => {console.log(`UPDATE Success: ${sourcefile.filename}`);update_count++;})
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

    pinghistory.unshift(log);
//Branch done

if(add_count+update_count+delete_count+attachment_add_count+attachment_delete_count > 0) {
    //Something changed..merge time

    //Merge
    const mergeOptions = {
        method: 'POST',
        headers: authheader(),
        body: JSON.stringify({
            committer,
            base: githubMergeTarget,
            head: branch,
            commit_message: `Merge branch '${branch}' into '${githubMergeTarget}'`
        })
    };

    await fetchJSON(`${githubApiUrl}${githubApiMerges}`, mergeOptions)
        .then(() => {console.log(`MERGE Success: ${githubMergeTarget} from ${branch}`);})
    //End Merge

} else 
    console.log(`MERGE Skipped - No Changes`);

    context.res = {
        body: {pinghistory},
        headers: {
            'Content-Type' : 'application/json'
        }
    };

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

function shalink(mysha, theirsha) {
    shadabase[mysha] = theirsha;
}

function shamatch(mysha, theirsha) {
    return shadabase[mysha]===theirsha;
}