// extract-data.js
/*

PURPOSE:
This file is used to parse the XML files provided from Socrates. See below for the various function names and the type of return value expected.


EXPORTS:
function getDepts(object parse_xml);
 -- Returns array of dept objects: { deptId: int, deptName: string }

function getProgTypes(object parse_xml);
 -- Returns array of prog types objects: { deptId: int, progTypeShort: string, progTypeLong: string }

function getProgNames(object parse_xml);
 -- Returns array of prog names objects: { programTitle: string, progType: string, deptId: int, progId: int }

function getCourses(object parse_xml);
 -- Returns array of course objects: { subjPrefix: string, courseNum: int, deptId: int, progId: int }

function getProgSLOs(obj parse_xml, querystring queryString);
 -- Returns array of strings for program SLOs

function getCourseDetails(string progId, string deptId, obj courses);
 -- Returns array of course details objects: { name: string, found: boolean, subjPrefix: string, courseNum: int }

function getCourseSLOs(object parse_xml, courseDetails courseDetailsObject);
 -- Returns array of arrays of course SLOs

*/

// HELPER FUNCTIONS

// Get Departments
function getDepts(obj) {
    let depts = [];
    obj.catalog_depts.catalog_dept.forEach(function(dept) {
        depts.push({
            deptId: dept.catalog_dept_id,
            deptName: dept.catalog_dept_announce.cdata
        });
    });
    return depts;
}
module.exports.getDepts = getDepts;


// Get Program Types
function getProgTypes(obj) {
    let progTypes = [];

    // Loop through departments
    for(let i = 0; i < obj.catalog_depts.catalog_dept.length; i++) {
        for(var prop in obj.catalog_depts.catalog_dept[i]) {
            // Find program types that match pattern in XML file
            if((typeof(obj.catalog_depts.catalog_dept[i][prop]) == "object") && !(obj.catalog_depts.catalog_dept[i][prop].cdata)) {
                let fullName = obj.catalog_depts.catalog_dept[i][prop][prop + "_announce"];
                fullName = fullName.replace("Certificates","Certificate").replace("Degrees","Degree");

                // Push program types and details onto array
                progTypes.push({
                    deptId: obj.catalog_depts.catalog_dept[i].catalog_dept_id,
                    progTypeShort: prop,
                    progTypeLong: fullName
                });
            }
        }
    }
    return progTypes;
}
module.exports.getProgTypes = getProgTypes;

// Get Program Names
function getProgNames(obj) {
    let progNames = [];

    // Loop through departments
    for(let i=0; i < obj.catalog_depts.catalog_dept.length; i++) {
        for(var progType in obj.catalog_depts.catalog_dept[i]) {
            // Find program types that match pattern in XML file
            if((typeof(obj.catalog_depts.catalog_dept[i][progType]) == "object") && !(obj.catalog_depts.catalog_dept[i][progType].cdata)) {
                for(var deg in obj.catalog_depts.catalog_dept[i][progType]) {
                    // Find programs that match pattern in XML file
                    if(typeof(obj.catalog_depts.catalog_dept[i][progType][deg]) == "object") {
                        // Fix issues if there are no programs listed
                        if (!Array.isArray(obj.catalog_depts.catalog_dept[i][progType][deg])) {
                            let degreeOption = obj.catalog_depts.catalog_dept[i][progType][deg];
                            obj.catalog_depts.catalog_dept[i][progType][deg] = [];
                            obj.catalog_depts.catalog_dept[i][progType][deg][0] = degreeOption;
                        }
                        // Loop through programs
                        obj.catalog_depts.catalog_dept[i][progType][deg].forEach(function(item, index){
                            progNames.push({
                                programTitle: item.program_title.cdata,
                                progType: progType,
                                deptId: obj.catalog_depts.catalog_dept[i].catalog_dept_id,
                                progId: item.socrates_program_id
                            })
                        });
                    }
                }
            }
        }
    }
    return progNames;
}
module.exports.getProgNames = getProgNames;


// Get Courses
function getCourses(obj) {
    let courses = [];

    // Loop through departments
    obj.catalog_depts.catalog_dept.forEach(function(dept) {
        for(var progType in dept) {
            // Find program types that match pattern in XML file
            if((typeof(dept[progType]) == "object") && !(dept[progType].cdata)) {
                for(var deg in dept[progType]) {
                    // Find programs that match pattern in XML file
                    if(typeof(dept[progType][deg]) == "object") {
                        _convertToArray(dept[progType], deg);

                        // Loop through programs
                        dept[progType][deg].forEach(function(program){
                            // Get courses, from two different course list formats
                            if(program.requirements.requirement) {
                                program.requirements.requirement.forEach(function(req) {
                                    if(req.course_row) {
                                        _convertToArray(req, "course_row");
                                        // Push courses onto array
                                        req.course_row.forEach(function(course) {
                                            courses.push({
                                                subjPrefix: course.course_code.subject_prefix,
                                                courseNum: course.course_code.course_num,
                                                deptId: dept.catalog_dept_id,
                                                progId: program.socrates_program_id
                                            });
                                        });
                                    }
                                    if(req.restricted_units) {
                                        _convertToArray(req.restricted_units.subrequirements, "subrequirement");
                                        req.restricted_units.subrequirements.subrequirement.forEach(function(subreq) {
                                            if(subreq.course_row) {
                                                _convertToArray(subreq, "course_row");
                                                // Push courses onto array
                                                subreq.course_row.forEach(function(course) {
                                                    courses.push({
                                                        subjPrefix: course.course_code.subject_prefix,
                                                        courseNum: course.course_code.course_num,
                                                        deptId: dept.catalog_dept_id,
                                                        progId: program.socrates_program_id
                                                    });
                                                });
                                            }
                                        });
                                    }
                                });
                            }
                        });
                    }
                }
            }
        }
    });
    return courses;
}
module.exports.getCourses = getCourses;

// Get Program SLOs
function getProgSLOs(obj, queryString) {
    let progSLOs = [];

    // Loop through departments
    obj.catalog_depts.catalog_dept.forEach(function(dept) {
        if(dept.catalog_dept_announce.cdata == queryString.department) {
            if (dept[queryString.prog_type]) {
                // Loop through prog types in matching dept
                for(var deg in dept[queryString.prog_type]) {
                    if(typeof(dept[queryString.prog_type][deg]) == "object") {
                        _convertToArray(dept[queryString.prog_type], deg);
                        // Loop through program in matching department
                        dept[queryString.prog_type][deg].forEach(function(program){
                            if (program.program_title.cdata == queryString.prog_name) {
                                // Push SLOs onto array
                                program.slos.slo.forEach(function(slo) {
                                    progSLOs.push(slo.cdata);
                                });
                            }
                        });
                    }
                }
            }
        }
    });
    return progSLOs;
}
module.exports.getProgSLOs = getProgSLOs;

// Get Course Details
function getCourseDetails(progId, deptId, courses) {
    let courseDetails = [];

    // Loop through all courses
    courses.forEach(function(course){
        if(course.progId == progId && course.deptId == deptId) {
            // Push courses onto array
            courseDetails.push({
                name: course.subjPrefix + course.courseNum,
                found: false,
                subjPrefix: course.subjPrefix,
                courseNum: course.courseNum
            });
        }
    });

    return courseDetails;
}
module.exports.getCourseDetails = getCourseDetails;

// Get Course SLOs
function getCourseSLOs(obj, courseDetails) {

    // Prep empty arrays
    let courseSLOs = [];
    for(let i = 0; i < courseDetails.length; i++) {
        courseSLOs.push([]);
    }
    
    // Loop through array of course details objects
    courseDetails.forEach(function(selCourse, index) {
        obj.catalog_depts.catalog_dept.forEach(function(dept) {
            _convertToArray(dept.subject_designators, "subject_designator");
            dept.subject_designators.subject_designator.forEach(function(subject){
                if(subject.courses) {
                    _convertToArray(subject.courses, "course");
                    // Loop through all courses
                    subject.courses.course.forEach(function(course){
                        if((course.subject_prefix == selCourse.subjPrefix) && (course.course_num == selCourse.courseNum)) {
                            if(course.slos.slo) {
                                course.slos.slo.forEach(function(slo){
                                    courseSLOs[index].push(slo.cdata);
                                });
                                selCourse.found = true;
                            }
                        }
                    });
                }
            });
        });
    });
    return courseSLOs;
}
module.exports.getCourseSLOs = getCourseSLOs;


// Convert to Array
// Internal use only, not exported
function _convertToArray(obj, element) {
    if (!Array.isArray(obj[element])) {
        let tempElement = obj[element];
        obj[element] = [];
        obj[element][0] = tempElement;
    }
}