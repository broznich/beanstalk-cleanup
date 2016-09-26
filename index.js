// jshint esversion:6

const aws = require('aws-sdk'),
    async = require('async'),
    fs = require('fs'),
    args = require('minimist')(process.argv.slice(2)),
    config = args.config || args.c;

if (config) {
    fs.readFile(config, function (error, buffer) {
        var awsCfg;

        if (error) {
            showError("Config file is unreadeble");
        }

        try {
            awsCfg = JSON.parse(buffer.toString());
        } catch (e) {
            return showError("Incorrect config file");
        }

        var bt = new aws.ElasticBeanstalk(awsCfg);
        var ec2 = new aws.EC2(awsCfg);
        var ec2tags = {};
        async.waterfall([
            function (callback) {
                if (awsCfg.filterByTag) {
                    ec2.describeTags({ 
                        Filters: [
                            {Name: "resource-type", Values: ["instance"]},
                            {Name: "key", Values: [awsCfg.filterByTag]},
                            {Name: "value", Values: [awsCfg.filterByTagValue]}
                        ],
                        MaxResults: 1000
                    }, function (error, tags) {
                        tags = tags.Tags || [];
                        console.log(tags);
                        tags.forEach(function (one) {
                            ec2tags[one.ResourceId] = one.Value;
                        });

                        console.log(ec2tags);
                        callback();
                    });
                } else {
                    callback();
                }
            },

            function (callback) {
                bt.describeApplications(function (error, data) {
                    callback(error, data);
                });
            },
            function (data, callback) {
                let apps = data.Applications;

                async.each(apps, function (app, appsCallback) {
                    function removeApp (error) {
                        if (error) {
                            appsCallback(error);
                        } else {
                            bt.deleteApplication({
                                ApplicationName: app.ApplicationName
                            }, function (err) {
                                appsCallback(err);
                            });
                        }
                    }

                    bt.describeEnvironments({
                        ApplicationName: app.ApplicationName
                    }, function (error, data) {
                        if (error) {
                            appsCallback(error);
                        } else {
                            let envs = data.Environments;

                            async.each(envs, function (env, envCallback) {
                                console.log(env);

                                bt.describeEnvironmentResources({
                                    EnvironmentId: env.EnvironmentId
                                }, function (error, data) {
                                    console.log(data);
                                    if (awsCfg.filterByTag) {
                                        let id = data.EnvironmentResources.Instances[0].Id;

                                        if (!ec2tags[id]) {
                                            return envCallback();
                                        }
                                    }

                                    async.series([
                                        function (callback) {
                                            if (env.Status === "Ready") {
                                                bt.terminateEnvironment({
                                                    EnvironmentId: env.EnvironmentId,
                                                    TerminateResources: true,
                                                    ForceTerminate: true
                                                }, function (error) {
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
                                        }
                                    ], function (error, result) {
                                        envCallback(error, result);
                                    });
                                });
                            }, function (error) {
                                removeApp(error);
                            });
                        }
                    });
                }, function (error) {
                    callback(error);
                });
            }
        ], function (error) {
            if (error) {
                process.stderr.write(error.message);
                process.exit(1);
            } else {
                process.stdout.write("Beanstalk instances terminated successfully");
                process.exit(0);
            }
        });
    });
} else {
    showError("Config is undefined. Use -c or --config option.");
}

function showError (message) {
    process.stderr.write(message + "\n");
    process.exit(1);
}