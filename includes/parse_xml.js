// parse_xml.js
/*
EXPORTS:
function parseXMLFile(string filepath);
 -- Returns JSON object corresponding to XML file

*/

// Required modules
var parser = require('fast-xml-parser');
var he = require('he');
var fs = require('fs');

// Parse XML File Wrapper
function parseXMLFile(xmlFilePath) {
    return new Promise(function(resolve,reject) {
        fs.readFile(xmlFilePath, 'utf8', function(err, data) {
            if (err) {
                reject(err);
            } else {
                resolve(parsePrograms(data));
            }
        });
    })
}

// XML Parsing Settings
function parsePrograms(xmlData) {
    var options = {
        attributeNamePrefix : "@_",
        attrNodeName: "attr", //default is 'false'
        textNodeName : "#text",
        ignoreAttributes : true,
        ignoreNameSpace : false,
        allowBooleanAttributes : false,
        parseNodeValue : true,
        parseAttributeValue : false,
        trimValues: true,
        cdataTagName: "cdata", //default is 'false'
        cdataPositionChar: "\\c",
        localeRange: "", //To support non english character in tag/attribute values.
        parseTrueNumberOnly: false,
        attrValueProcessor: a => he.decode(a, {isAttributeValue: true}),//default is a=>a
        tagValueProcessor : a => he.decode(a) //default is a=>a
    };
     
    if( parser.validate(xmlData) === true) { //optional (it'll return an object in case it's not valid)
        var jsonObj = parser.parse(xmlData,options);
    }
     
    // Intermediate obj
    var tObj = parser.getTraversalObj(xmlData,options);
    var jsonObj = parser.convertToJson(tObj,options);

    return jsonObj;
}

module.exports = parseXMLFile;