const fetch = require('node-fetch');

let pinghistory = [];

const committer = {
    'name': 'WordPressService',
    'email': 'data@alpha.ca.gov'
};

const githubApiUrl = 'https://api.github.com/repos/cagov/covid19/';
//const githubBranch = 'master';
const githubBranch = 'synctest';

const githubSyncFolder = 'pages'; //no slash at the end
const githubImagesTargetFolder = 'src/img'; //no slash at the end
const wpFilePrefix = '/wp-content/uploads';
const githubImagesCheckFolder = `${githubImagesTargetFolder}${wpFilePrefix}`; //no slash at the end
const wordPressUrl = 'https://as-go-covid19-d-001.azurewebsites.net';
const wordPressApiUrl = `${wordPressUrl}/wp-json/wp/v2/`;
const defaultTags = ['covid19'];
const ignoreFiles = ['index.html'];

const githubApiContents = 'contents/';
const ignoreCategorySlug = 'do-not-deploy';

//attachments here...sourcefiles[1]._links['wp:attachment'][0].href

//sourcefiles[0]._links['wp:attachment'][0].href
//https://as-go-covid19-d-001.azurewebsites.net/wp-json/wp/v2/media?parent=375
//sourcefiles[0].id

module.exports = async function (context, req) {
    //Logging data
    const started = getPacificTimeNow();
    let add_count = 0;
    let update_count = 0;
    let delete_count = 0;
    let match_count = 0;
    let attachment_count = 0;
    let attachment_add_count = 0;
    let attachment_delete_count = 0;

    //Common Fetch functions
    const fetchJSON = async (URL, options) => 
        await fetch(URL,options)
        .then(response => response.ok ? response.json() : Promise.reject(response))
        .catch(async response => {
            const json = await response.json()

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

    const targetAttachmentFiles = await fetch(`${githubApiUrl}${githubApiContents}${githubImagesCheckFolder}?ref=${githubBranch}`,defaultoptions())
        .then(response => response.ok ? response.json() : []);

    //List of WP attachments
    const sourceattachments = (await fetchJSON(`${wordPressApiUrl}media?per_page=100`))
        .filter(x=>x.post)

    attachment_count = sourceattachments.length;

    let sourceAttachmentFiles = [];

    for (const sourceattachment of sourceattachments) {
        for (const sizename of Object.keys(sourceattachment.media_details.sizes)) {
            const sourcefile = sourceattachment.media_details.sizes[sizename];

            //flatten the file path
            sourcefile.newpath = `${githubImagesTargetFolder}/wp-content/uploads/${sourcefile.source_url.replace('/wp-content/uploads/','').replace(/\//g,'-')}`;
            sourceAttachmentFiles.push(sourcefile);
        }
    }

    //Make sure all the sourcefiles get added
    for (const sourcefile of sourceAttachmentFiles) {
        //If this file isn't there, add it
        if(!targetAttachmentFiles.find(x=>x.path===sourcefile.newpath)) {
            const filebytes =  await fetch(`${wordPressUrl}${sourcefile.source_url}`);
            const buffer = await filebytes.arrayBuffer();
            const base64 =  Buffer.from(buffer).toString('base64');

            const fileAddOptions = getPutOptions({
                "message": `Add file ${sourcefile.file}`,
                "committer": committer,
                "branch": githubBranch,
                "content": base64
            });
        
            await fetchJSON(`${githubApiUrl}${githubApiContents}${sourcefile.newpath}`, fileAddOptions)
                .then(() => {console.log(`ATTACHMENT ADD Success: ${sourcefile.file}`);attachment_add_count++;});
        }
    }

    //Remove extra files
    for (const targetfile of targetAttachmentFiles) {
        //If this file isn't there, add it
        if(!sourceAttachmentFiles.find(x=>targetfile.path===x.newpath)) {
            const options = {
                method: 'DELETE',
                headers: authheader(),
                body: JSON.stringify({
                    "message": `Delete ${targetfile.name}`,
                    "committer": committer,
                    "branch": githubBranch,
                    "sha": targetfile.sha
                })
            };
    
            await fetchJSON(`${githubApiUrl}${githubApiContents}${targetfile.path}`, options)
                .then(() => {console.log(`ATTACHMENT DELETE Success: ${targetfile.name}`);attachment_delete_count++;})
        }
    }

    
    //List of WP categories
    const categories = (await fetchJSON(`${wordPressApiUrl}categories`))
        .map(x=>({id:x.id,name:x.name,slug:x.slug}));

    //ID of category to ignore
    const ignoreCategoryId = categories.find(x=>x.slug===ignoreCategorySlug).id;

    const taglist = (await fetchJSON(`${wordPressApiUrl}tags`))
        .map(x=>({id:x.id,name:x.name}));


    //Query WP files
    //const sourcefiles = await fetchJSON(`${wordPressApiUrl}posts?per_page=100&categories_exclude=${ignoreCategoryId}`)
    const sourcefiles = await fetchJSON(`${wordPressApiUrl}posts?per_page=100&categories=${ignoreCategoryId}`)

    //Add custom columns to sourcefile data
    sourcefiles.forEach(sourcefile => {
        sourcefile['filename'] = sourcefile.slug;

        const pagetitle = sourcefile.title.rendered;
        const meta = sourcefile.excerpt.rendered.replace(/<p>/,'').replace(/<\/p>/,'').replace(/\n/,'').trim();
        const matchedtags = sourcefile.tags.map(x=>taglist.find(y=>y.id===x).name);

        sourcefile['html'] = `---\nlayout: "page.njk"\ntitle: "${pagetitle}"\nmeta: "${meta}"\nauthor: "State of California"\npublishdate: "${sourcefile.modified_gmt}Z"\ntags: "${defaultTags.concat(matchedtags).join(',')}"\n---\n`
            +sourcefile.content.rendered;
    });

    //Query GitHub files
    const targetfiles = (await fetchJSON(`${githubApiUrl}${githubApiContents}${githubSyncFolder}?ref=${githubBranch}`,defaultoptions()))
        .filter(x=>x.type==='file'&&x.name.endsWith('.html')&&!ignoreFiles.includes(x.name)); 

    //Add custom columns to targetfile data
    targetfiles.forEach(x=>x['filename']=x.name.split('.')[0]);
    
    //Files to delete
    for(const deleteTarget of targetfiles.filter(x=>!sourcefiles.find(y=>x.filename===y.filename))) {
        const options = {
            method: 'DELETE',
            headers: authheader(),
            body: JSON.stringify({
                "message": `Delete ${deleteTarget.path}`,
                "committer": committer,
                "branch": githubBranch,
                "sha": deleteTarget.sha
            })
        };

        await fetchJSON(`${githubApiUrl}${githubApiContents}${deleteTarget.path}`, options)
            .then(() => {console.log(`DELETE Success: ${deleteTarget.path}`);delete_count++;})
    }

    //ADD/UPDATE
    for(const sourcefile of sourcefiles) {
        const targetfile = targetfiles.find(y=>sourcefile.filename===y.filename);
        const base64 = Base64.encode(sourcefile.html);
        
        let body = {
            "message": "",
            "committer": committer,
            "branch": githubBranch,
            "content": base64
        };

        if(targetfile) {
            //UPDATE
            const targetcontent = await fetchJSON(`${githubApiUrl}git/blobs/${targetfile.sha}`,defaultoptions())
            
            if(base64!==targetcontent.content.replace(/\n/g,'')) {
                //Update file
                body.message=`Update ${targetfile.path}`;
                body['sha']=targetfile.sha;

                await fetchJSON(`${githubApiUrl}${githubApiContents}${targetfile.path}`, getPutOptions(body))
                    .then(() => {console.log(`UPDATE Success: ${targetfile.path}`);update_count++;})
            } else {
                console.log(`Files matched: ${targetfile.path}`);
                match_count++;
            }
        } else {
            //ADD
            const newFilePath = `${githubSyncFolder}/${sourcefile.filename}.html`;
            body.message=`ADD ${newFilePath}`;
            
            await fetchJSON(`${githubApiUrl}${githubApiContents}${newFilePath}`, getPutOptions(body))
                .then(() => {console.log(`ADD Success: ${newFilePath}`);add_count++;})
        }
    }

    //Add to log
    const log = {
        started,
        completed: getPacificTimeNow(),
        match_count
    };

    if(req.method==="GET") log.method = req.method;
    if(add_count>0) log.add_count = add_count;
    if(update_count>0) log.update_count = update_count;
    if(delete_count>0) log.delete_count = delete_count;
    if(attachment_count>0) log.attachment_count = attachment_count;
    if(attachment_add_count>0) log.attachment_add_count = attachment_add_count;
    if(attachment_delete_count>0) log.attachment_delete_count = attachment_delete_count;

    pinghistory.unshift(log);

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

const Base64={_keyStr:"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=",encode:function(e){var t="";var n,r,i,s,o,u,a;var f=0;e=Base64._utf8_encode(e);while(f<e.length){n=e.charCodeAt(f++);r=e.charCodeAt(f++);i=e.charCodeAt(f++);s=n>>2;o=(n&3)<<4|r>>4;u=(r&15)<<2|i>>6;a=i&63;if(isNaN(r)){u=a=64}else if(isNaN(i)){a=64}t=t+this._keyStr.charAt(s)+this._keyStr.charAt(o)+this._keyStr.charAt(u)+this._keyStr.charAt(a)}return t},decode:function(e){var t="";var n,r,i;var s,o,u,a;var f=0;e=e.replace(/++[++^A-Za-z0-9+/=]/g,"");while(f<e.length){s=this._keyStr.indexOf(e.charAt(f++));o=this._keyStr.indexOf(e.charAt(f++));u=this._keyStr.indexOf(e.charAt(f++));a=this._keyStr.indexOf(e.charAt(f++));n=s<<2|o>>4;r=(o&15)<<4|u>>2;i=(u&3)<<6|a;t=t+String.fromCharCode(n);if(u!=64){t=t+String.fromCharCode(r)}if(a!=64){t=t+String.fromCharCode(i)}}t=Base64._utf8_decode(t);return t},_utf8_encode:function(e){e=e.replace(/\r\n/g,"n");var t="";for(var n=0;n<e.length;n++){var r=e.charCodeAt(n);if(r<128){t+=String.fromCharCode(r)}else if(r>127&&r<2048){t+=String.fromCharCode(r>>6|192);t+=String.fromCharCode(r&63|128)}else{t+=String.fromCharCode(r>>12|224);t+=String.fromCharCode(r>>6&63|128);t+=String.fromCharCode(r&63|128)}}return t},_utf8_decode:function(e){var t="";var n=0;var r=c1=c2=0;while(n<e.length){r=e.charCodeAt(n);if(r<128){t+=String.fromCharCode(r);n++}else if(r>191&&r<224){c2=e.charCodeAt(n+1);t+=String.fromCharCode((r&31)<<6|c2&63);n+=2}else{c2=e.charCodeAt(n+1);c3=e.charCodeAt(n+2);t+=String.fromCharCode((r&15)<<12|(c2&63)<<6|c3&63);n+=3}}return t}}