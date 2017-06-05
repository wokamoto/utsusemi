'use strict';

const console = require('console');
const yaml = require('js-yaml');
const fs = require('fs');
const packageInfo = JSON.parse(fs.readFileSync(__dirname + '/../../package.json', 'utf8'));
const config = yaml.safeLoad(fs.readFileSync(__dirname + '/../../config.yml', 'utf8'));
const serverlessConfig = yaml.safeLoad(fs.readFileSync(__dirname + '/../../serverless.yml', 'utf8'));
const moment = require('moment');
const aws = require('aws-sdk');
aws.config.region = config.region;
const s3 = new aws.S3({
    apiVersion: '2006-03-01'
});
const lambda = new aws.Lambda({
    region: config.region
});
const sqs = new aws.SQS({
    apiVersion: '2012-11-05'
});
const functionS3Name = serverlessConfig.functions.s3worker.name
      .replace('${self:service}', serverlessConfig.service)
      .replace('${self:provider.stage}', serverlessConfig.provider.stage);
const targetHost = config.targetHost;
const bucketName = config.bucketName;
const queueName = serverlessConfig.resources.Resources.Channel.Properties.QueueName
      .replace('${self:service}', serverlessConfig.service)
      .replace('${self:provider.stage}', serverlessConfig.provider.stage);
const request = require('request-promise-native');
const querystring = require('querystring');
const scraper = require('./scraper');
const utsusemi = require('./utsusemi');

const crawler = {
    walk: (path, depth, uuid) => {
        console.info('walk:' + path);
        return Promise.resolve()
            .then(() => {
                if (depth == 0 || !depth) {
                    return [200, {
                        message: 'Finish'
                    }];
                }

                if (!path || !path.match(/^\//) || !uuid) {
                    return [400, {
                        message: 'Bad Request'
                    }];
                }

                const bucketKey = utsusemi.bucketKey(path);

                const objectParams = {
                    Bucket: bucketName,
                    Key: bucketKey
                };

                let headers = {
                    'User-Agent': `utsusemi/${packageInfo.version}`
                };
                if (config.crawlerUserAgent) {
                    // custom User-Agent
                    headers['User-Agent'] = config.crawlerUserAgent;
                }

                return s3.getObjectTagging(objectParams).promise()
                    .then((data) => {
                        // Object exist
                        let status = {};
                        data.TagSet.forEach((tag) => {
                            status[tag.Key] = tag.Value;
                        });
                        // Check uuid & depth
                        if (status.uuid === uuid && status.depth >= depth) {
                            console.info('status.uuid === uuid && status.depth >= depth:' + path);
                            return true;
                        }
                        // Check expires
                        if (status.expires > moment().unix()){
                            if (status.contentType.match(/(html|css)/)) {
                                // HTML or CSS
                                return lambda.invoke({
                                    FunctionName: functionS3Name,
                                    InvocationType: 'Event',
                                    Payload: JSON.stringify({
                                        path: path,
                                        depth: depth,
                                        uuid: uuid,
                                        contentType: status.contentType
                                    })
                                }).promise().then(() => {
                                    return true;
                                }).catch((err) => {
                                    console.error(err);
                                    throw err;
                                });
                            }
                        }
                        // Set If-None-Match to headers by etag
                        if (status.etag !== '-') {
                            headers['If-None-Match'] = status.etag;
                        }
                        // Set If-Modified-Since to headers by lastModified
                        headers['If-Modified-Since'] = moment(status.lastModified, 'X').toDate().toUTCString();
                        const options = {
                            method: 'GET',
                            uri: targetHost + path,
                            encoding: null,
                            headers: headers,
                            resolveWithFullResponse: true
                        };

                        return request(options).then((res) => {
                            return res;
                        }).catch((err) => {
                            // Check statusCode
                            if ([403, 404, 410].includes(err.statusCode)) {
                                return true;
                            }
                            if (err.statusCode !== 304) {
                                throw err;
                            }
                            if (status.contentType.match(/(html|css)/)) {
                                // HTML or CSS
                                return lambda.invoke({
                                    FunctionName: functionS3Name,
                                    InvocationType: 'Event',
                                    Payload: JSON.stringify({
                                        path: path,
                                        depth: depth,
                                        uuid: uuid,
                                        contentType: status.contentType
                                    })
                                }).promise().then(() => {
                                    return true;
                                }).catch((err) => {
                                    console.error(err);
                                    throw err;
                                });
                            }
                            return true;
                        });
                    })
                    .catch((err) => {
                        // Object not exist
                        if (err.code !== 'NoSuchKey') {
                            throw err;
                        }
                        const options = {
                            method: 'GET',
                            uri: targetHost + path,
                            encoding: null,
                            headers: headers,
                            resolveWithFullResponse: true
                        };
                        return request(options).then((res) => {
                            return res;
                        }).catch((err) => {
                            // Check statusCode
                            if ([403, 404, 410].includes(err.statusCode)) {
                                return true;
                            }
                            throw err;
                        });
                    })
                    .then((res) => {
                        if (res === true) {
                            return true;
                        }
                        let contentType = 'text/html';
                        let now = moment().unix();
                        let expires = now;
                        let etag = '-';
                        let lastModified = now;
                        for(let h in res.headers) {
                            if (h.toLowerCase() === 'Content-Type'.toLowerCase()) {
                                contentType = res.headers[h].replace(/;.*$/, '');
                            }
                            if (h.toLowerCase() === 'Expires'.toLowerCase()) {
                                expires = moment(res.headers[h]).unix();
                            }
                            if (h.toLowerCase() === 'Etag'.toLowerCase()) {
                                etag = res.headers[h].replace(/"/g,'');
                            }
                            if (h.toLowerCase() === 'Last-Modified'.toLowerCase()) {
                                lastModified = moment(res.headers[h]).unix();
                            }
                        }
                        const status = {
                            contentType: contentType,
                            expires: expires,
                            etag: etag,
                            lastModified: lastModified,
                            depth: depth,
                            uuid: uuid
                        };

                        const queueParams = {
                            QueueName: queueName
                        };

                        if (!contentType.match(/(html|css)/)) {
                            const objectParams = {
                                Bucket: bucketName,
                                Key: bucketKey,
                                Body: res.body,
                                ContentType: contentType,
                                Tagging: querystring.stringify(status)
                            };
                            return Promise.all([
                                [],
                                sqs.getQueueUrl(queueParams).promise(),
                                s3.putObject(objectParams).promise()
                            ]);
                        }
                        let body = '';
                        let filtered = [];
                        let results = ['',[]];
                        if (contentType.match(/html/)) {
                            results = scraper.scrapeHTML(res.body.toString(), path, targetHost);
                            body = results[0];
                            filtered = results[1];
                        } else if (contentType.match(/css/)) {
                            results = scraper.scrapeCSS(res.body.toString(), path, targetHost);
                            body = results[0];
                            filtered = results[1];
                        }

                        const objectParams = {
                            Bucket: bucketName,
                            Key: bucketKey,
                            Body: body,
                            ContentType: contentType,
                            Tagging: querystring.stringify(status)
                        };
                        return Promise.all([
                            filtered,
                            sqs.getQueueUrl(queueParams).promise(),
                            s3.putObject(objectParams).promise()
                        ]);
                    })
                    .then((data) => {
                        if (data === true || depth - 1 === 0) {
                            return true;
                        }
                        const filtered = data[0];
                        const queueUrl = data[1].QueueUrl;
                        return crawler.queue(path, depth, uuid, queueUrl, filtered);
                    })
                    .then(() => {
                        return [200, {
                            message: 'Accepted'
                        }];
                    });
            });
    },
    s3walk: (path, depth, uuid, contentType) => {
        if (!contentType.match(/(html|css)/)) {
            throw new 's3walk support only HTML or CSS.';
        }
        return Promise.resolve()
            .then(() => {
                if (depth == 0 || !depth) {
                    return [200, {
                        message: 'Finish'
                    }];
                }

                if (!path || !path.match(/^\//) || !uuid) {
                    return [400, {
                        message: 'Bad Request'
                    }];
                }

                const bucketKey = utsusemi.bucketKey(path);

                const objectParams = {
                    Bucket: bucketName,
                    Key: bucketKey
                };

                return s3.getObject(objectParams).promise()
                    .then((data) => {
                        let results = ['', []];
                        if (contentType.match(/html/)) {
                            results = scraper.scrapeHTML(data.Body.toString(), path, targetHost);
                        } else if (contentType.match(/css/)) {
                            results = scraper.scrapeCSS(data.Body.toString(), path, targetHost);
                        }
                        const filtered = results[1];

                        const queueParams = {
                            QueueName: queueName
                        };

                        return Promise.all([
                            filtered,
                            sqs.getQueueUrl(queueParams).promise()
                        ]);
                    })
                    .then((data) => {
                        if (data === true || depth - 1 === 0) {
                            return true;
                        }
                        const filtered = data[0];
                        const queueUrl = data[1].QueueUrl;
                        return crawler.queue(path, depth, uuid, queueUrl, filtered);
                    })
                    .then(() => {
                        return [200, {
                            message: 'Accepted'
                        }];
                    });
            });
    },
    queue: (path, depth, uuid, queueUrl, filtered) => {
        let queues = [];
        filtered.forEach((path) => {
            const cache = `/tmp/${utsusemi.path(path).replace(/\//g, '__dir__')}-${(depth - 1)}-${uuid}`;
            if (crawler.isFileExist(cache)) {
                // cache hit
                return;
            }
            const params = {
                MessageBody: JSON.stringify({
                    path: path,
                    depth: depth - 1,
                    uuid: uuid
                }),
                QueueUrl: queueUrl
            };
            queues.push(sqs.sendMessage(params).promise());
            fs.writeFile(cache, 'cache');
        });
        return Promise.all(queues);
    },
    isFileExist: (path) => {
        try {
            fs.accessSync(path);
            return true;
        } catch (err) {
            if(err.code === 'ENOENT') {
                return false;
            }
            throw err;
        }
    }
};

module.exports = crawler;
