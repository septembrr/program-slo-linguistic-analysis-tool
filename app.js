"use strict";

// Required modules
const fs = require('fs');
const https = require('https');
const pug = require('pug');
const express = require('express');
const app = express();
const mysql = require('mysql');
var session = require('express-session');
var mysqlStore = require('express-mysql-session')(session);
const privateKey = fs.readFileSync('../master/localhost.key','utf8');
const certificate = fs.readFileSync('../master/localhost.crt','utf8');
const portNumber = fs.readFileSync('.port','utf8').trim();
const credentials = { key: privateKey, cert: certificate };
const orgName = 'Design Hub';
const querystring = require('querystring');
const logins = require('./logins.js');
const mailjet = require ('node-mailjet').connect(logins.mailjetApiKey, logins.mailjetSecretKey);
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
var bodyParser = require('body-parser');
const {OAuth2Client} = require('google-auth-library');

// Custom modules
const analyze = require('./includes/link-parse');
const xmlParse = require('./includes/parse_xml');
const extractData = require('./includes/extract-data');
const routes = require('./includes/routes.js');

// Body parser setup
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Mysql database
var mysqlOptions = logins.mysqlOptions(routes.dbPrefix);

// MYSQL Promisify
class Database {
    constructor( config ) {
        this.connection = mysql.createConnection( config );
    }
    query( sql, args ) {
        return new Promise( ( resolve, reject ) => {
            this.connection.query( sql, args, ( err, rows, fields ) => {
                if ( err )
                    return reject( err );
                resolve( {rows: rows, fields: fields} );
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

// Set up database and sessions
var database = new Database(mysqlOptions);
var sessionStore = new mysqlStore(mysqlOptions);
app.use(session({
    key: routes.dbPrefix+'cookie',
    secret: logins.sessionSecret, 
    store: sessionStore, 
    resave: false, 
    saveUninitialized: false, 
    cookie: { maxAge: 60*60000, path: '/', secure: true }
}));

// Express settings
app.set('view engine', 'pug');
app.use(express.static('public'));

// HOMEPAGE
app.get('/', function (req, res, next) {

    // For all data to pass to pug
    let data = {};

    // Authenticate
    routes.authenticate(req.session.token).then(function(result) {
        data.role = (result) ? result : "";
        return xmlParse('./xml/programs.xml');

    })
    // Get data from programs
    .then(function(result){
    
        data.depts = extractData.getDepts(result);
        data.progTypes = extractData.getProgTypes(result);
        data.progNames = extractData.getProgNames(result);
        data.courses = extractData.getCourses(result);

        // Compile and output page
        const compiledFunction = pug.compileFile('./views/index.pug');
        
        const pageOutput = compiledFunction({
            title: 'Program SLO',
            subtitle: 'Linguistic Analysis Tool',
            form_depts: data.depts,
            form_progTypes: data.progTypes,
            form_progNames: data.progNames,
            form_courseNames: data.courses,
            message: req.query.message,
            successMsg: req.query.success,
            generate: false,
            role: data.role
        });

        res.write(pageOutput);
        res.end();
    
    }).catch(function(error) {
        console.log(error);
    });

});

// ANALYSIS
app.get('/analysis', function (req, res, next) {

    // For all data to pass to pug
    let data = {};

    // Authenticate
    routes.authenticate(req.session.token).then(function(result) {
        data.role = (result) ? result : "";
        // Get data from programs
        return xmlParse('./xml/programs.xml');
    
    })
    // Parse program results
    .then(function(result){
        data.courses = extractData.getCourses(result);

        // Get Program SLOs
        data.progSLOs = extractData.getProgSLOs(result, req.query);

        return xmlParse('./xml/courses.xml');

    })
    // Parse course results
    .then(function(result) {
        data.progId = req.query.progId.split("-")[1];
        data.deptId = req.query.progId.split("-")[2];

        data.courseDetails = extractData.getCourseDetails(data.progId, data.deptId, data.courses);
        data.courseSLOs = extractData.getCourseSLOs(result, data.courseDetails);

        // Get data from courses overridden by faculty
        let selectQuery = "SELECT "+
                                routes.dbPrefix+"Courses.courseNum as courseNum, "+
                                routes.dbPrefix+"PSLOs.progID as progID, "+
                                routes.dbPrefix+"PSLOs.slo, "+
                                routes.dbPrefix+"Faculty.firstName as fname, "+
                                routes.dbPrefix+"Faculty.lastName as lname, "+
                                routes.dbPrefix+"Faculty.email, "+
                                routes.dbPrefix+"Match.matched, " + 
                                routes.dbPrefix+"Match.date " + 
                                "FROM "+routes.dbPrefix+"Match " +
                        "JOIN "+routes.dbPrefix+"PSLOs on "+routes.dbPrefix+"PSLOs.id = "+routes.dbPrefix+"Match.sloID " +
                        "JOIN "+routes.dbPrefix+"Courses on "+routes.dbPrefix+"Courses.id = "+routes.dbPrefix+"Match.courseID " +
                        "JOIN "+routes.dbPrefix+"Faculty on "+routes.dbPrefix+"Faculty.id = "+routes.dbPrefix+"Match.facultyID " +
                        "WHERE progID = "+mysql.escape(data.progId)+" AND (";
        data.courseDetails.forEach(function(course){
            selectQuery += " courseNum = " + mysql.escape(course.name) + " OR ";
        });
        selectQuery += " NULL );"
        
        return database.query(selectQuery);
            
    })
    // Parse course overrides
    .then(function(rows){
        data.overrides = Object.values(JSON.parse(JSON.stringify(rows)))[0];
    
        // Get overall program reviews
        let selectReviewQuery = "SELECT "+
                            routes.dbPrefix+"Approve.id, "+
                            routes.dbPrefix+"Approve.date, "+
                            routes.dbPrefix+"Approve.actions, "+
                            routes.dbPrefix+"Approve.notes, "+
                            routes.dbPrefix+"Faculty.firstName, "+
                            routes.dbPrefix+"Faculty.lastName, "+
                            routes.dbPrefix+"Faculty.email, "+
                            routes.dbPrefix+"Depts.name AS deptName "+
                            "FROM "+routes.dbPrefix+"Approve "+
                            "JOIN "+routes.dbPrefix+"Faculty on "+
                            routes.dbPrefix+"Faculty.id = "+routes.dbPrefix+"Approve.facultyID "+
                            "JOIN "+routes.dbPrefix+"Depts on "+
                            routes.dbPrefix+"Approve.deptID = "+routes.dbPrefix+"Depts.id "+
                            "WHERE "+routes.dbPrefix+"Approve.progID = "+mysql.escape(data.progId)+";";
        
        return database.query(selectReviewQuery);
    
    })
    // Parse data from program reviews
    .then(function(rows){
        data.reviews = Object.values(JSON.parse(JSON.stringify(rows)))[0];

        return analyze.evaluateMatch(data.courseSLOs, data.progSLOs, database);

    })
    // Evaluate matches between courses and program
    .then(function(result) {
    
        // Get results from match function
        data.matchResults = analyze.evaluateOverrides(result, data.overrides, data.courseDetails, data.progSLOs);

        // Get total match for display
        data.totalMatch = [];
        data.matchResults.forEach(function(progSLOGroup, matchIndex){
            data.totalMatch[matchIndex] = 0;
            progSLOGroup.forEach(function(matchGroup){
                data.totalMatch[matchIndex] += matchGroup.value;
            })
        });
            
        // CSV Export setup
        let date = new Date();
        data.csvPath = data.linkPath = 'csv/' + 
            date.getFullYear() + "-" + 
            ('0' + (date.getMonth() + 1)).slice(-2) + "-" +
            ('0' + date.getDate()).slice(-2) + "-" +
            ('0' + date.getHours()).slice(-2) + "-" +
            ('0' + date.getMinutes()).slice(-2) + "-" +
            ('0' + date.getSeconds()).slice(-2) + ".csv";
        data.csvPath = 'public/' + data.csvPath;

        var header = [];
        header.push({id: 'progSLO', title: 'PROGRAM SLO'});
        header.push({id: 'supported', title: 'PSLO SUPPORTED?'});
    
        // CSV export headers
        let courseHeader = {};
        data.courseDetails.forEach(function(course){
            courseHeader = {};
            courseHeader.id = course.name;
            courseHeader.title = course.name.toUpperCase();
            header.push(courseHeader);
        });

        const csvWriter = createCsvWriter({
            path: data.csvPath,
            header: header
        });
            
        // Push records onto CSV
        data.records = [];
        let record = {};
        data.progSLOs.forEach(function(slo, index){
            record = {};
            record.progSLO = slo;
            record.supported = (data.totalMatch[index] > 0) ? 'YES' : 'NO';
            data.courseDetails.forEach(function(course, i) {
                record[course.name] = (data.matchResults[index][i].value > 0) ? 'X' : '';
            });
            data.records.push(record);
        });

        // Write to CSV
        return csvWriter.writeRecords(data.records);

    })
    // Output page
    .then(function(result){

        const compiledFunction = pug.compileFile('./views/analysis.pug');

        const pageOutput = compiledFunction({
            title: 'Program SLO',
            subtitle: 'Linguistic Analysis Tool',
            progName: req.query.prog_name,
            dept: req.query.department,
            courses: data.courseDetails,
            progSLO: data.progSLOs,
            courseSLOs: data.courseSLOs,
            matched: data.matchResults,
            totalMatch: data.totalMatch,
            progId: data.progId,
            reviews: data.reviews,
            csv: data.linkPath,
            role: data.role
        });
        
        res.write(pageOutput);
        res.end(); 
    
    }).catch(function(error) {
        console.log(error);
    });
  
});

// OVERRIDE
app.get('/override', function (req, res, next) {

    // Authenticate
    routes.authenticate(req.session.token).then(function(result) {

        let role = (result) ? result : "";

        if (role == "Admin" || role == "Reviewer") {
        
            // Compile and pass output to pug
            const compiledFunction = pug.compileFile('./views/override.pug');
            const pageOutput = compiledFunction({
                title: 'Program SLO',
                subtitle: 'Linguistic Analysis Tool',
                progId: req.query.progId,
                courseNum: req.query.courseNum,
                slo: req.query.slo,
                generate: false,
                role: role
            });
        
            // Generate page
            res.write(pageOutput);
            res.end();
        
        }

    }).catch(function(error) {
        console.log(error);
    });

});

// ADDING OVERRIDE
app.post('/override-submit', function (req, res, next) {

    // Authenticate
    routes.authenticate(req.session.token).then(function(result) {
        // Get role of current user
        let role = (result) ? result : "";

        if (role == "Admin" || role == "Reviewer") {
            // Insert course if not present
            let query = "INSERT IGNORE INTO "+routes.dbPrefix+"Courses (courseNum) values ("+mysql.escape(req.body.courseNum)+");";
            
            database.query(query).then(function(result){
                let query = "INSERT IGNORE INTO "+routes.dbPrefix+"PSLOs (progID, slo) values ("+mysql.escape(req.body.progId)+", "+mysql.escape(req.body.slo)+");";
                return database.query(query);
        
            }).then(function(result){
        
                // Insert faculty if not present
                let query = "INSERT IGNORE INTO "+routes.dbPrefix+"Faculty (firstName, lastName, email) values ("+mysql.escape(req.body.firstName)+", "+mysql.escape(req.body.lastName)+", "+mysql.escape(req.body.email)+");";
                return database.query(query);
        
            }).then(function(result){
        
                // Insert match
                let query = "INSERT IGNORE INTO "+routes.dbPrefix+"Match (sloID, courseID, matched, facultyID, date) values (" +
                    "(SELECT id FROM "+routes.dbPrefix+"PSLOs WHERE progID="+mysql.escape(req.body.progId)+" AND slo="+mysql.escape(req.body.slo)+"), "+
                    "(SELECT id FROM "+routes.dbPrefix+"Courses WHERE courseNum="+mysql.escape(req.body.courseNum)+"), "+
                    mysql.escape(req.body.matched)+","+
                    "(SELECT id FROM "+routes.dbPrefix+"Faculty WHERE email="+mysql.escape(req.body.email)+"), "+
                    mysql.escape(req.body.date)+");"
                return database.query(query);
        
            })
            // Redirect on success
            .then(function(result){
        
                res.redirect('/express/program_slo/?message=Override added successfully.&success=1');
        
            })
            // Redirect on failure
            .catch(function(error){

                res.redirect('/express/program_slo/?message=ERROR: Override not added successfully.&success=0');

            });

        } 
        // Redirect on failure
        else {
            res.redirect('/express/program_slo/?message=ERROR: Override not added successfully.&success=0');
        }

    }).catch(function(error) {
        console.log(error);
    });

});

// ADDING REVIEW
app.post('/submit-review', function (req, res, next) {

    routes.authenticate(req.session.token).then(function(result) {
        let role = (result) ? result : "";

        if (role == "Admin" || role == "Reviewer") {
            let insertQuery = "INSERT IGNORE INTO "+routes.dbPrefix+"Program (progID, name) values (?,?);";

            database.query(insertQuery, [req.body.progId,req.body.progName]).then(function(result){
                let insertQuery = "INSERT IGNORE INTO "+routes.dbPrefix+"Faculty (firstName, lastName, email) values (?, ?, ?);";
                return database.query(insertQuery, [req.body.firstName,req.body.lastName,req.body.email]);
            }).then(function(result){
                let insertQuery = "INSERT IGNORE INTO "+routes.dbPrefix+"Depts (name) values (?);";
                return database.query(insertQuery, [req.body.dept]);
            }).then(function(result){
                let insertQuery = "INSERT IGNORE INTO "+routes.dbPrefix+"Approve (progID, facultyID, date, actions, notes, deptID, csv) values (?, (SELECT id FROM "+routes.dbPrefix+"Faculty WHERE email=?), ?, ?, ?,(SELECT id FROM "+routes.dbPrefix+"Depts where name=?), ?);";
                let csv = "https://power.arc.losrios.edu/express/program_slo/" + req.body.csv;
                return database.query(insertQuery,[req.body.progId,req.body.email,req.body.date,req.body.actions,req.body.notes,req.body.dept,csv]);
            }).then(function(result){
                var csvFile = fs.readFileSync('public/' + req.body.csv);
                let actions = (req.body.actions) ? 'Actions Needed/Taken' : 'No Actions Needed/Taken ';
        
                const emailMessage = mailjet.post("send", {'version': 'v3.1'}).request({
                    "Messages":[
                        {
                        "From": {
                            "Email": logins.fromEmail,
                            "Name": "American River College"
                        },
                        "To": [
                            {
                            "Email": req.body.email,
                            "Name": req.body.firstName + " " + req.body.lastName
                            }
                        ],
                        "Subject": req.body.progName + " Review Submitted",
                        "TextPart": req.body.progName + " Review Submitted",
                        "HTMLPart": "<p><strong>Thank you!</strong> Your review has been submitted.</p><p>A copy of the data you submitted is below.</p><ul><li>Name: "+req.body.firstName+" "+req.body.lastName+"</li><li>Email: "+req.body.email+"</li><li>Program: "+req.body.progName+"</li><li>Department: "+req.body.dept+"</li><li>Actions: "+actions+"</li><li>Date: "+req.body.date+"</li><li>Notes: "+req.body.notes+"</li></ul>",
                        "Attachments": [
                            {
                            'Filename': req.body.csv,
                            'ContentType': 'text/csv',
                            'Base64Content': csvFile.toString('base64')
                            }
                        ],
                        "CustomID": "SLOMessage"
                        }
                    ]
                });
        
                res.redirect('/express/program_slo/?message=Review added successfully.&success=1');
        
            }).catch(function(error) {
                res.redirect('/express/program_slo/?message=ERROR: Review not added successfully.&success=0');
            });
        }

    }).catch(function(error) {
        console.log(error);
    });


});

// ADDING OVERRIDE
app.get('/delete-override', function (req, res, next) {

    routes.authenticate(req.session.token).then(function(result) {

        let role = (result) ? result : "";

        if (role == "Admin" || role == "Reviewer") {
            
            let deleteQuery = "DELETE FROM "+routes.dbPrefix+"Match WHERE "+
                "courseID = (SELECT id FROM "+routes.dbPrefix+"Courses WHERE courseNum="+mysql.escape(req.query.courseNum)+") AND "+
                "sloID = (SELECT id FROM "+routes.dbPrefix+"PSLOs WHERE progId="+mysql.escape(req.query.progId)+" AND slo="+mysql.escape(req.query.slo)+")"+
                ";"
        
            database.query(deleteQuery).then(function(result){
        
                res.redirect('/express/program_slo/?message=Override deleted successfully.&success=1');
        
            }).catch(function(error) {
                res.redirect('/express/program_slo/?message=ERROR: Override not deleted successfully.&success=0');
            });

        }

    }).catch(function(error) {
        console.log(error);
    });

});

// DELETE REVIEW
app.get('/delete-review', function (req, res, next) {

    routes.authenticate(req.session.token).then(function(result) {
        let role = (result) ? result : "";
        if (role == "Admin" || role == "Reviewer") {
            let deleteQuery = "DELETE FROM "+routes.dbPrefix+"Approve WHERE id = "+mysql.escape(req.query.id)+";";
            database.query(deleteQuery).then(function(result){
                res.redirect('/express/program_slo/?message=Review deleted successfully.&success=1');
            }).catch(function(error) {
                res.redirect('/express/program_slo/?message=ERROR: Review not deleted successfully.&success=0');
            });
        }

    }).catch(function(error) {
        console.log(error);
    });

});

// ADMIN DISPLAY PAGE
app.get('/admin', function (req, res, next) {

    // For all data to pass to pug
    var data = {};

    // Authenticate
    routes.authenticate(req.session.token).then(function(result) {
        data.role = (result) ? result : "";
        // Display the page if user has a role
        if (data.role) {
            // Add user if query string matches
            if (req.query['add-user']) {
                let query = "INSERT IGNORE INTO "+routes.dbPrefix+"Faculty(firstName, lastName, email) VALUES("+mysql.escape(req.query.firstName)+", "+mysql.escape(req.query.lastName)+", "+mysql.escape(req.query.email)+");";
                database.query(query).then(function(result){
                    let facultyID = (result.insertID) ? result.insertID : "(SELECT id FROM "+routes.dbPrefix+"Faculty WHERE email="+mysql.escape(req.query.email)+")";
                    query = "INSERT IGNORE INTO "+routes.dbPrefix+"Users(facultyID, role) VALUES ("+facultyID+", "+mysql.escape(req.query.role)+")";
                    return database.query(query);
                }).then(function(resolve, reject) {
                    routes.displayAdmin(data, req, res, next);
                }).catch(function(error) {
                    console.log(error);
                });
            } 
            // Delete user
            else if (req.query['delete-user']) {
        
                let query = "DELETE FROM "+routes.dbPrefix+"Users WHERE id="+mysql.escape(req.query.id)+";";
        
                database.query(query).then(function(resolve, reject) {
                    routes.displayAdmin(data, req, res, next);
                }).catch(function(error) {
                    console.log(error);
                });
        
            } 
            // Else, just display the page
            else {
                new Promise(function(resolve, reject) {
                    routes.displayAdmin(data, req, res, next);
                }).catch(function(error) {
                    console.log(error);
                });
            }
    
        } 
        // Not logged in? Redirect to login
        else {
            res.redirect('/express/program_slo/login');
        }
    });
});

// LOGIN
app.get('/login', function (req, res, next) {
    // For all data to pass to pug
    var data = {};

    const compiledFunction = pug.compileFile('./views/login.pug');

    // Compile and display page
    const pageOutput = compiledFunction({
        title: 'Program SLO',
        subtitle: 'Linguistic Analysis Tool'
    });

    res.write(pageOutput);
    res.end();
});

// AUTHENTICATION
app.post('/auth', function(req, res, next) {

    // For all data to pass to pug
    var data = {};

    // Token variable
    let token = (req.body.idtoken) ? req.body.idtoken : "";

    const client = new OAuth2Client(logins.googleClientId);
    async function verify() {
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: logins.googleClientId,
        });
        const payload = ticket.getPayload();
        const userid = payload['sub'];

        if (payload) {
            // Set up query
            let google_id_query = "SELECT DISTINCT "+
                routes.dbPrefix+"Users.googleID, "+
                routes.dbPrefix+"Users.role "+
                "FROM "+routes.dbPrefix+"Users "+
                "WHERE googleID = "+mysql.escape(payload['sub'])+";";
            let email_query = "SELECT DISTINCT "+
                routes.dbPrefix+"Users.id, "+
                routes.dbPrefix+"Faculty.email, "+
                routes.dbPrefix+"Users.role "+
                "FROM "+routes.dbPrefix+"Users "+
                "JOIN "+routes.dbPrefix+"Faculty ON "+routes.dbPrefix+"Faculty.id = "+routes.dbPrefix+"Users.facultyID "+
                "WHERE "+routes.dbPrefix+"Faculty.email = "+mysql.escape(payload['email'])+";";

            database.query(google_id_query).then(function(result){
                data.idResults = result.rows[0];

                return database.query(email_query);

            }).then(function(result){
                data.emailResults = result.rows[0];
                if(!req.session.token) {
                    req.session.token = token;
                }

                if(data.idResults) {
                    // set session.role to slo_Users.role
                    if(!req.session.role) {
                        req.session.role = data.idResults.role;
                    }
                    return new Promise(function(resolve, reject) {
                        resolve("Success");
                    });
                } else if (data.emailResults) {
                    // set session.role to slo_Users.role
                    if(!req.session.role) {
                        req.session.role = data.emailResults.role;
                    }

                    let updateQuery = "UPDATE "+routes.dbPrefix+"Users SET googleID = "+mysql.escape(payload['sub'])+" WHERE id = "+data.emailResults.id+";";

                    return database.query(updateQuery);
                } else {
                    return new Promise(function(resolve, reject) {
                        resolve("Invalid");
                    });
                }

            }).then(function(result){
                let message = (result == "Invalid") ? "Invalid" : "Success";
                res.send(message);
            }).catch(function(error) {
                console.log(error);
            });

        } else {
            res.send("Invalid");
        }
    }
    verify().catch(console.error);

});

// LOGOUT
app.get('/logout', function(req, res, next) {

    req.session.destroy(function(err) {
        console.log(err);
    })

    const compiledFunction = pug.compileFile('./views/logout.pug');

    const pageOutput = compiledFunction({
        title: 'Program SLO',
        subtitle: 'Linguistic Analysis Tool'
    });

    res.write(pageOutput);
    res.end();

});

// Start Server
var httpsServer = https.createServer(credentials, app);
httpsServer.listen(portNumber);
