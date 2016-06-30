var aws = require('aws-sdk');
var async = require('async');

var config = {
    accessKeyId:        "KEY",
    secretAccessKey:    "SECRET",
    region:             "us-east-1"
};

var bt = new aws.ElasticBeanstalk(config);
var s3 = new aws.S3(config);

async.waterfall([
    function (callback) {
        bt.describeApplications(function (error, data) {
            callback(error, data);
        });
    },
    function (data, callback) {
        let apps = data.Applications;

        async.each(apps, function (app, appsCallback) {
            bt.describeEnvironments({
                ApplicationName: app.ApplicationName
            }, function (error, data) {
                if (error) {
                    appsCallback(error);
                } else {
                    let envs = data.Environments;

                    async.each(envs, function (env, envCallback) {
                        async.series([
                            function (callback) {
                                if (env.Status === "Ready") {
                                    bt.terminateEnvironment({
                                        EnvironmentId: env.EnvironmentId,
                                        TerminateResources: true,
                                        ForceTerminate: true
                                    }, function (error, data) {
                                        callback(error);
                                    });
                                } else {
                                    callback(null);
                                }
                            },
                            function (callback) {
                                let maxAttempts = 20;
                                let checkInterval = setInterval(function () {
                                    if (env.Status === "Terminated") {
                                        clearInterval(checkInterval);
                                        callback();
                                        return;
                                    }

                                    if (maxAttempts-- === 0) {
                                        clearInterval(checkInterval);
                                        callback("Terminate environment timeout error");
                                    }
                                }, 10000);
                            },
                            function (callback) {
                                bt.describeApplicationVersions({
                                    ApplicationName: app.ApplicationName
                                }, function (error, data) {
                                    let vers = data.ApplicationVersions;

                                    async.each(vers, function (ver, callback) {
                                        bt.deleteApplicationVersion({
                                            ApplicationName: app.ApplicationName,
                                            VersionLabel: ver.VersionLabel,
                                            DeleteSourceBundle: true
                                        }, function (error) {
                                            callback(error);
                                        });
                                    }, function (error) {
                                        callback(error);
                                    });
                                });
                            },
                            function (callback) {
                                bt.deleteApplication({
                                    ApplicationName: app.ApplicationName
                                }, function (error) {
                                    callback(error);
                                });
                            }
                        ], function (error, result) {
                            envCallback(error, result);
                        });
                    }, function (error) {
                        appsCallback(error);
                    });
                }
            });
        }, function (error) {
            callback(error);
        });
    }
], function (error, result) {
    if (error) {
        process.stderr.write(error.message);
        process.exit(1);
    } else {
        process.stdout.write("Beanstalk instances terminated successfully");
        process.exit(0);
    }
});

