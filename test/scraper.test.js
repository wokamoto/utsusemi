'use strict';

const fs = require('fs');
const describe = require('mocha').describe;
const it = require('mocha').it;
const before = require('mocha').before;
const assert = require('power-assert');
const Scraper = require('../src/lib/scraper');

describe('scraper.scrapeHTML()', () => {
    let scraper;
    let config;
    before((done) => {
        config = {targetHost: 'https://example.com'};
        scraper = new Scraper(config);
        done();
    });
    it ('<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd">', () => {
        const htmlStr = '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" "http://www.w3.org/TR/html4/loose.dtd"><html><head></head><body><h1>Hello</h1></body></html>';
        const path = '/path/to/';
        const scraped = scraper.scrapeHTML(htmlStr, path);
        assert(scraped[0].match('4.01 Transitional'));
    });
    it ('Scrape <table> <tr> <td> <th> `backgroud` attribute image', () => {
        const htmlStr = '<table background="table.jpg"><tr background="../tr.jpg"><th background="../../th.jpg"></th><td background="./td.jpg"></td></tr></table><table></table>';
        const path = '/path/to/';
        const scraped = scraper.scrapeHTML(htmlStr, path);
        assert(scraped[0].match('/path/to/table.jpg'));
        assert(scraped[0].match('/path/tr.jpg'));
        assert(scraped[0].match('/th.jpg'));
        assert(scraped[0].match('/path/to/td.jpg'));
        assert(scraped[1].toString() === [
            '/path/to/table.jpg',
            '/path/tr.jpg',
            '/th.jpg',
            '/path/to/td.jpg'
        ].toString());
    });
});

describe('scraper.scrapeCSS()', () => {
    let scraper;
    let config;
    before((done) => {
        config = {targetHost: 'https://example.com'};
        scraper = new Scraper(config);
        done();
    });
    it ('Scrape valid CSS', () => {
        const cssStr = fs.readFileSync(__dirname + '/fixtures/valid.css', 'utf8');
        const path = '/path/to/';
        const scraped = scraper.scrapeCSS(cssStr, path);
        assert(scraped[1].toString() === [].toString());
    });
    it ('Scrape valid CSS with `url()`', () => {
        const cssStr = fs.readFileSync(__dirname + '/fixtures/valid_with_url.css', 'utf8');
        const path = '/path/to/';
        const scraped = scraper.scrapeCSS(cssStr, path);
        assert(scraped[0].match('/img/logo.png'));
        assert(scraped[0].match('/path/img/title.png'));
        assert(scraped[0].match('/path/to/img/same.png'));
        assert(!scraped[0].match(/'img\/same\.png'/));
        assert(scraped[1].toString() === ['/img/logo.png', '/path/img/title.png', '/path/to/img/same.png'].toString());
    });
    it ('Scrape valid CSS with `@import`', () => {
        const cssStr = fs.readFileSync(__dirname + '/fixtures/valid_with_import.css', 'utf8');
        const path = '/path/to/';
        const scraped = scraper.scrapeCSS(cssStr, path);
        assert(scraped[0].match('/css/common.css'));
        assert(scraped[0].match('/css/reset.css'));
        assert(scraped[0].match('/path/css/sub.css'));
        assert(scraped[0].match('/path/css/style.css'));
        assert(scraped[1].toString() === ['/css/common.css', '/css/reset.css', '/path/css/sub.css', '/path/css/style.css'].toString());
    });
    it ('Scrape valid CSS with `@font-face`', () => {
        const cssStr = fs.readFileSync(__dirname + '/fixtures/valid_with_font-face.css', 'utf8');
        const path = '/path/to/';
        const scraped = scraper.scrapeCSS(cssStr, path);
        assert(scraped[0].match('/path/to/webfont.eot'));
        assert(scraped[0].match('/path/to/webfont-utsusemi-7b7d.eot#iefix'));
        assert(scraped[0].match('/path/webfont.woff2'));
        assert(scraped[0].match('/path/webfont.woff'));
        assert(scraped[0].match('/webfont.ttf'));
        assert(scraped[0].match('/webfont.svg#svgFontName'));
        assert(scraped[1].toString() === [
            '/path/to/webfont.eot',
            '/path/to/webfont.eot?#iefix',
            '/path/webfont.woff2',
            '/path/webfont.woff',
            '/webfont.ttf',
            '/webfont.svg#svgFontName'
        ].toString());
    });
    it ('Scrape invalid CSS', () => {
        const cssStr = fs.readFileSync(__dirname + '/fixtures/invalid.css', 'utf8');
        const path = '/path/to/';
        const scraped = scraper.scrapeCSS(cssStr, path);
        assert(scraped[0] === cssStr);
        assert(scraped[1].toString() === [].toString());
    });
    it ('Scrape invalid CSS with `url()`', () => {
        const cssStr = fs.readFileSync(__dirname + '/fixtures/invalid_with_url.css', 'utf8');
        const path = '/path/to/';
        const scraped = scraper.scrapeCSS(cssStr, path);
        assert(scraped[0].match('/img/logo.png'));
        assert(scraped[0].match('/path/img/title.png'));
        assert(scraped[0].match('/path/to/img/same.png'));
        assert(!scraped[0].match(/'img\/same\.png'/));
        assert(scraped[1].toString() === ['/img/logo.png', '/path/img/title.png', '/path/to/img/same.png'].toString());
    });
    it ('Scrape invalid CSS with `@import`', () => {
        const cssStr = fs.readFileSync(__dirname + '/fixtures/invalid_with_import.css', 'utf8');
        const path = '/path/to/';
        const scraped = scraper.scrapeCSS(cssStr, path);
        assert(scraped[0].match('/css/common.css'));
        assert(scraped[0].match('/css/reset.css'));
        assert(scraped[0].match('/path/css/sub.css'));
        assert(scraped[0].match('/path/css/style.css'));
        assert(scraped[1].toString() === ['/css/reset.css', '/path/css/style.css', '/css/common.css', '/path/css/sub.css'].toString());
    });
    it ('Scrape invalid CSS with `@font-face`', () => {
        const cssStr = fs.readFileSync(__dirname + '/fixtures/valid_with_font-face.css', 'utf8');
        const path = '/path/to/';
        const scraped = scraper.scrapeCSS(cssStr, path);
        assert(scraped[0].match('/path/to/webfont.eot'));
        assert(scraped[0].match('/path/to/webfont-utsusemi-7b7d.eot#iefix'));
        assert(scraped[0].match('/path/webfont.woff2'));
        assert(scraped[0].match('/path/webfont.woff'));
        assert(scraped[0].match('/webfont.ttf'));
        assert(scraped[0].match('/webfont.svg#svgFontName'));
        assert(scraped[1].toString() === [
            '/path/to/webfont.eot',
            '/path/to/webfont.eot?#iefix',
            '/path/webfont.woff2',
            '/path/webfont.woff',
            '/webfont.ttf',
            '/webfont.svg#svgFontName'
        ].toString());
    });
});
