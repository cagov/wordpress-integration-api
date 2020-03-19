const md5 = require('md5');

module.exports = function createCDPHItem(sourceFile) {
  let newFile = {}
  newFile.filename = md5(sourceFile.url)
  newFile.html = `---\nlayout: "page.njk"\ntitle: "${sourceFile.title}"\nmeta: "${sourceFile.description}"\ntags: "guidancefeed"\nurl: "https://www.cdph.ca.gov${sourceFile.url}"\nauthor: "California Department of Public Health"\npublishdate: "${sourceFile.date}"\n---\n\n<p><a href="https://www.cdph.ca.gov${sourceFile.url}">${sourceFile.title}</a></p><p>${sourceFile.description}</p>`
  return newFile;
}