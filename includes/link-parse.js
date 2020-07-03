// link-parse.js
/*
EXPORTS:
function getSentenceConstituents(string sentence, Database database);
 -- Returns object of sentence constituents e.g. {n: "cat", v: ["eat", "run"]}

function getSynonyms(string word, string partOfSpeech);

function evaluateMatch(array of arrays of courseSLOs, array programSLO);
-- Returns array of match statistics

*/

// Required Modules
const execSync = require('child_process').execSync;
const exec = require('child_process').exec;
const spawnSync = require('child_process').spawnSync;

const mysql = require('mysql');
const routes = require('./routes.js');
const logins = require('../logins.js');

// MYSQL Promisify
class Database {
    constructor( config ) {
        this.connection = mysql.createConnection( config );
    }
    query( sql, args ) {
        return new Promise( ( resolve, reject ) => {
            this.connection.query( sql, args, ( err, rows ) => {
                if ( err )
                    return reject( err );
                resolve( rows );
            } );
        } );
    }
    close() {
        return new Promise( ( resolve, reject ) => {
            this.connection.end( err => {
                if ( err )
                    return reject( err );
                resolve();
            } );
        } );
    }
}

// Mysql database
const dbPrefix = routes.dbPrefix;
var database = new Database(logins.mysqlOptions(dbPrefix));

// LINK PARSER 
// -------------------------------------------------------------------------------

function getSentenceConstituents(sentence, database) {

    if(!sentence) {
        return [];
    } else {

        // Get results from cache
        let selectQuery = "SELECT links FROM "+dbPrefix+"LinkCache WHERE sentence = ? LIMIT 1;";
        let linkResult = "";

        return database.query(selectQuery, [sentence]).then(function(row){
            row = Object.values(JSON.parse(JSON.stringify(row)))[0][0];

            // If nothing in cache, run the link parser
            if(!row) {
                let costmax = 1;

                let origSentence = sentence;

                sentence = sentence.replace(/\'/g, '’');
                sentence = sentence.replace(/\"/g, '’');
                sentence = sentence.trim();
                if(sentence.length > 400) {
                    costmax++;
                } else {
                    sentence = sentence.toLowerCase();                     // to avoid different parsing for capitalized words
                }
                let command = "echo '" + sentence + "' | link-parser -constituents=2 -graphics=0 -cost-max=" + costmax.toString();
                linkResult = execSync(command,{encoding: 'utf8'});
                
                // Strip unneeded content, prep for parsing
                linkResult = linkResult.match(/(?<=\[)(.*)(?=\])/g)[0];         // strip comments surrounding
                linkResult = linkResult.replace(/ a | the | , | \. /g, ' ');    // Remove short words
                linkResult = linkResult.replace(/\{[!?~&]\}|\[PP | PP\]|\[VP | VP\]|\[S | S\]|\[SBAR | SBAR\]|\[WHNP | WHNP\]|\[ADJP | ADJP\]|^S | S$/g, '');
                linkResult = linkResult.replace(/\.[dhijker]|\.e-[a-z]/g, '');      // Remove parts of speech we don't care about
                linkResult = linkResult.replace(/\.n-[a-z]|\.[mfbcloqsp]/g, '.n');  // Update adapted nouns (.n-u, etc)
                linkResult = linkResult.replace(/\.v-[a-z]|\.g/g, '.v');            // Update adapted verbs (.v-d, etc)
                linkResult = linkResult.replace(/\.a-[a-z]/g, '.a');            // Update adapted adjs (.a-c, etc)
                linkResult = linkResult.replace(/\s+/g, ' ');                   // Condense extra whitespace to single character
                linkResult = linkResult.replace(/\(/g, "\(");                   // escape parentheses
                linkResult = linkResult.replace(/\)/g, "\)");
                linkResult = linkResult.trim();                                 // Strip extra whitespace
                
                let insertQuery = "INSERT IGNORE into "+dbPrefix+"LinkCache(sentence, links) values(?, ?);";

                return database.query(insertQuery, [origSentence, linkResult]);
                
            } 
            // Use values from link parse
            else {
                linkResult = row.links;

                return new Promise(function(resolve,reject){
                    resolve();
                });
            }
        }).then(function(rows){
            return _parseConstituentResults(linkResult);
        }).catch(function(error) {
            console.log(error);
        });
    }
}

// Parse results from link grammar
// Internal Function
function _parseConstituentResults(linkResult) {
    let keywords = {};
    
    // Matches noun phrases
    // For capturing multi-word nouns
    keywords.n = linkResult.match(/(?<=\[NP )([a-zA-Z \.]*?)(?= NP\])/g) || [];
    for(let i = 0; i < keywords.n.length; ++i) {
        keywords.n[i] = keywords.n[i].replace(/ *the */g, '');
        keywords.n[i] = keywords.n[i].replace(/\.[-a-z]*/g, '');
        keywords.n[i] = keywords.n[i].replace(/ /g, '_');
    }

    // Parse remaining individual words
    linkResult = linkResult.replace(/\[NP | NP\]/g, '');
    let words_arr = linkResult.split(" ");
    let indiv_word = [];
    words_arr.forEach(function(e){
        if(e.indexOf('.') > 0) {
            indiv_word = e.split(".");
            if (keywords[indiv_word[1]]) {
                if (keywords[indiv_word[1]].indexOf(indiv_word[0]) == -1) {
                    keywords[indiv_word[1]].push(indiv_word[0]);
                }
            } else {
                keywords[indiv_word[1]] = new Array();
                keywords[indiv_word[1]].push(indiv_word[0]);
            }
        }
    });

    return keywords;
}

module.exports.getSentenceConstituents = getSentenceConstituents;


// WORDNET
// -----------------------------------------------------
// Note on wordnet - Commands in CLI and through execSync/spawnSync return with unreliable error codes,
// despite the command being run successfully.
// To avoid this, using spawnSync so that an object is returned, then specifically getting stdout.

function getSynonyms(word, pos) {
    let synonyms = {
        searchTerm : word,
        pos : pos,
        senses : [],
        syns : []
    };

    if(!word || !pos) {
        return synonyms;
    } else {
        // Run command on WordNet
        let posCommand = "-syns" + pos;
        let synResult = spawnSync('wordnet', [word, posCommand], {encoding: 'utf8', env: {WNHOME: '/home1/designhub/wordnet', WNSEARCHDIR: '/home1/designhub/wordnet'} });
        
        let lines = synResult.stdout.split("\n");
        lines.splice(0,5);
        
        // Parse results and split into senses and synonyms
        let sense = "";
        for(var i = 0; i < lines.length; i++) {
            if(lines[i].includes("Sense")) {
                sense = lines[i+1].split(", ")[0];
                if(synonyms.senses.indexOf(sense) < 0) {
                    synonyms.senses.push(sense);
                }
            } else if (lines[i].includes("=>")) {
                synonyms.syns = synonyms.syns.concat(lines[i].trim().replace(/=> /g,'').split(", "));
            }
        }

        return synonyms;
    }
}

module.exports.getSynonyms = getSynonyms;


// MATCHING
// --------------------------------------------------------------

function evaluateMatch(courseSLOs, progSLO, database) {

    // Get program SLO sentence constituents
    
    // Variables to Use in Promise Chain
    let progStruct = [];
    let progSyns = [];
    let progResult = {};
    let courseStruct = [];
    let courseSyns = [];
    let courseResult = {};
    
    let matchStats = [];
    let tempStats = {};
    let tempKey = "";
    
    for(let i = 0; i < progSLO.length; i++) {
        progStruct[i] = getSentenceConstituents(progSLO[i], database);
    }

    return Promise.all(progStruct).then(function(results){
        progStruct = results;
    
        for(let i = 0; i < progSLO.length; i++) {
            progSyns[i] = [];
            for(let pos in progStruct[i]) {
                progStruct[i][pos].forEach(function(e) {
                    progSyns[i].push(getSynonyms(e, pos));
                });
            }
        }

        // Get course SLO sentence constituents
        courseSLOs.forEach(function(courseSLO, courseIndex){
            courseStruct[courseIndex] = [];
            courseSyns[courseIndex] = [];
            for(let i = 0; i < courseSLO.length; i++) {
                courseStruct[courseIndex][i] = getSentenceConstituents(courseSLO[i], database);
                courseSyns[courseIndex][i] = [];
            }
        });

        return Promise.all(courseStruct.map(function callback(item){
            return Promise.all(item);
        }));
        
    }).then(function(results){
        courseStruct = results;

        courseSLOs.forEach(function(courseSLO, courseIndex){
            for(let i = 0; i < courseSLO.length; i++) {
                for(let pos in courseStruct[courseIndex][i]) {
                    courseStruct[courseIndex][i][pos].forEach(function(e){
                        courseSyns[courseIndex][i].push(getSynonyms(e, pos));
                    });
                }
            }
        });

        // Compare program constituents to course constituents
        for(let progIndex = 0; progIndex < progSLO.length; progIndex++) {
            matchStats[progIndex] = [];
            courseSLOs.forEach(function(courseSLO, cIndex){
                matchStats[progIndex][cIndex] = { value: 0, keywords: [] };
                for(let courseIndex = 0; courseIndex < courseSLO.length; courseIndex++) {
                    tempStats = comparePhrase(progStruct[progIndex], progSyns[progIndex], courseStruct[cIndex][courseIndex], courseSyns[cIndex][courseIndex]);
                    matchStats[progIndex][cIndex].value += tempStats.value[0] + (tempStats.value[1] / 2);
                    tempStats.keywords.forEach(function(keyword){
                        if(matchStats[progIndex][cIndex].keywords.indexOf(keyword) < 0) {
                            tempKey = keyword.replace(/_/g, ' ');
                            matchStats[progIndex][cIndex].keywords.push(tempKey);
                        }
                    });
                }
            });
        }

        return matchStats;
        
    }).catch(error => { 
        console.error(error);
    });
}

module.exports.evaluateMatch = evaluateMatch;


function evaluateOverrides(matches, overrides, courses, progSLOs) {

    matches.forEach(function(course, i){
        course.forEach(function(slo, j) {
            // Add empty override object to stats
            slo.override = {
                active: false,
                matched: true,
                faculty: "",
                email: "",
                date: ""
            };
            // Check if override exists
            overrides.forEach(function(entry, index) {
                if (entry.courseNum == courses[j].name && entry.slo == progSLOs[i]) {
                    slo.override.active = true;
                    slo.override.matched = entry.matched;
                    slo.override.faculty = entry.fname + " " + entry.lname;
                    slo.override.email = entry.email;
                    slo.override.date = entry.date.slice(0,10);
                    if(slo.override.matched){
                        slo.value++;
                    } else {
                        slo.value = 0;
                    }
                }
            });
        });
    });

    return matches;
}

module.exports.evaluateOverrides = evaluateOverrides;

// Compare phrases
// We are comparing two SLOs - one program SLO and one course SLO
function comparePhrase (progStruct, progSyns, courseStruct, courseSyns) {

    let matchStats = {
        keywords: [],
        value: [ 0, 0, 0 ]
    };

    // Compare course synonyms to program phrase structure
    courseSyns.forEach(function(synonyms){
        // Exact word matches
        if((progStruct[synonyms.pos]) && (progStruct[synonyms.pos].indexOf(synonyms.searchTerm) >= 0) && (matchStats.keywords.indexOf(synonyms.searchTerm) < 0)) {
            matchStats.keywords.push(synonyms.searchTerm);
            matchStats.value[0]++;
        }
        synonyms.senses.forEach(function(sense){
            // If matches progStruct and not already matched
            if((progStruct[synonyms.pos]) && (progStruct[synonyms.pos].indexOf(sense) >= 0) && (matchStats.keywords.indexOf(sense) < 0)) {
                matchStats.keywords.push(sense);
                matchStats.value[0]++;
            }
        });
        synonyms.syns.forEach(function(syn){
            // If matches progStruct and not already matched
            if((progStruct[synonyms.pos]) && (progStruct[synonyms.pos].indexOf(syn) >= 0) && (matchStats.keywords.indexOf(syn) < 0)) {
                matchStats.keywords.push(syn);
                matchStats.value[1]++;
            } 
        });
    });

    // Compare program synonyms to course phrase structure
    progSyns.forEach(function(synonyms) {
        // Exact word matches
        if(courseStruct[synonyms.pos] && (courseStruct[synonyms.pos].indexOf(synonyms.searchTerm) >= 0) && (matchStats.keywords.indexOf(synonyms.searchTerm) < 0)) {
            matchStats.keywords.push(synonyms.searchTerm);
            matchStats.value[0]++;
        }
        synonyms.senses.forEach(function(sense){
            // If matches courseStruct and not already matched
            if(courseStruct[synonyms.pos] && (courseStruct[synonyms.pos].indexOf(sense) >= 0) && (matchStats.keywords.indexOf(synonyms.searchTerm) < 0)) {
                matchStats.keywords.push(synonyms.searchTerm);
                matchStats.value[0]++;
            }
        });
        synonyms.syns.forEach(function(syn){
            // If matches courseStruct and not already matched
            if(courseStruct[synonyms.pos] && (courseStruct[synonyms.pos].indexOf(syn) >= 0) && (matchStats.keywords.indexOf(synonyms.searchTerm) < 0)) {
                matchStats.keywords.push(synonyms.searchTerm);
                matchStats.value[1]++;
            }
        });
    });
    
    // return array of matchstats
    return matchStats;
}