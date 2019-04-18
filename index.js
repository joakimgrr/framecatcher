'use strict';

const ffmpeg = require('fluent-ffmpeg');
const timeSpan = require('time-span');
const fs = require('fs');
const PNG = require('pngjs').PNG;
const pixelmatch = require('pixelmatch');
const tmp = require('tmp-promise');

/**
 * Splits a given videofile into individual frames
 * @param {string} videoPath path for videofile
 * @param {string} outputPath path for output frames
 */
const splitVideoToFrames = (videoPath, outputPath) => {
  return new Promise((resolve, reject) => {
    /**
     * By default ffmpeg outputs all info to stderr to keep stdout
     * clear for data (piping). Set loglevel to error so stderr can be
     * used to actually detect an error.
     */
    ffmpeg(videoPath)
      .outputOptions('-loglevel error')
      .save(`${outputPath}/frame%04d.png`)
      .on('end', (stdout, stderr) => {
        if (!stderr) {
          resolve(outputPath);
        } else {
          reject(stderr);
        }
      })
  })
}

const createTempFolder = async () => {
  // Delete folder even if it has files in it
  const settings = { unsafeCleanup: true };

  const dirInfo = await tmp.dir(settings);
  return dirInfo.path;
};

//splitVideoToFrames('./input.mp4', './frames');

const readImage = (path) => {
  return new Promise((resolve, reject) => {
    fs
      .createReadStream(path)
      .pipe(new PNG())
      .on('parsed', function() {
        resolve(this)
      })
      .on('error', (err) => reject(err))
  });
}

const calculateFrameDiff = async (
  framePathA,
  framePathB,
  settings = { threshold: 0.1 }
) => {
    const { threshold } = settings;

    const [frameA, frameB] = await Promise.all([
      readImage(framePathA),
      readImage(framePathB),
    ]);

    return pixelmatch(frameA.data, frameB.data, null, frameA.width, frameA.height, { threshold });
};

const getFrameCount = async (path) => {
  return new Promise((resolve, reject) => {
    fs.readdir(path, (err, files) => {
      if (err) {
        return reject(err);
      }

      resolve(files.length)
    });
  })
}

const frameCatch = async (
  videoPathA,
  videoPathB,
  settings = {
    stopOnFirstFail: false,
    frameInterval: null,
    writeToFile: false,
  },
) => {
  const { stopOnFirstFail, frameInterval, writeToFile } = settings;

  const resultObject = {
    pass: true,
    type: 'full', // full or partial depending if stopOnFirstFail is true
    error: null, // reason for failing
    settings,
    times: {
      splitToFrames: 0,
      diffFrames: 0,
    },
    result: {
      videoA: {
        frameCount: 0,
      },
      videoB: {
        frameCount: 0,
      },
      frames: {}, // because interval can be changed, this cant be an array
    },
  };

  const [folderAPath, folderBPath] = await Promise.all([
    createTempFolder(),
    createTempFolder(),
  ]);

  const videoFrameTimer = timeSpan();

  const [videoFramesPathA, videoFramesPathB] = await Promise.all([
    splitVideoToFrames(videoPathA, folderAPath),
    splitVideoToFrames(videoPathB, folderBPath),
  ]);

  // Time framing part and report in ms
  const videoFramingTime = videoFrameTimer.rounded();
  resultObject.times.splitToFrames = videoFramingTime;

  const [videoAframecount, videoBframecount] = await Promise.all([
    getFrameCount(videoFramesPathA),
    getFrameCount(videoFramesPathB),
  ]);

  resultObject.result.videoA.frameCount = videoAframecount;
  resultObject.result.videoB.frameCount = videoBframecount;

  // Videos cant be similar if framecount doesn't match
  if (videoAframecount !== videoBframecount) {
    resultObject.pass = false;
    return resultObject;
  }

  const framecount = videoAframecount;
  const interval = frameInterval || 1;

  const totalFrameDiffTimer = timeSpan();
  for (var i = 1; i < framecount; i += interval) {
    const paddedFrameNumber = `${i}`.padStart(4, "0");
    const frameASource = `${videoFramesPathA}/frame${paddedFrameNumber}.png`
    const frameBSource = `${videoFramesPathB}/frame${paddedFrameNumber}.png`

    const frameDiffTimer = timeSpan();
    const frameDiff = await calculateFrameDiff(frameASource, frameBSource);
    const frameDiffTime = frameDiffTimer.rounded();

    resultObject.result.frames[i] = { time: 0, diff: 0 };
    resultObject.result.frames[i].diff = frameDiff;
    resultObject.result.frames[i].time= frameDiffTime;

    if (frameDiff > 0) {
      resultObject.pass = false;
      if (stopOnFirstFail) {
        resultObject.type = 'partial';
        break;
      }
    }
  }

  const totalFrameDiffTime = totalFrameDiffTimer.rounded();
  resultObject.times.diffFrames = totalFrameDiffTime;

  if (writeToFile) {
    const json = JSON.stringify(resultObject);
    fs.writeFileSync('report.json', json, 'utf8');
  }

  return resultObject;
};

module.exports = frameCatch;
