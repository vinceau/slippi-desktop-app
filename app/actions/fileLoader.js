import _ from 'lodash';
import fs from 'fs';
import path from 'path';
import moment from 'moment';
import SlippiGame from 'slp-parser-js';

import { displayError } from './error';
import { gameProfileLoad } from './game';

const electronSettings = require('electron-settings');

export const LOAD_ROOT_FOLDER = 'LOAD_ROOT_FOLDER';
export const CHANGE_FOLDER_SELECTION = 'CHANGE_FOLDER_SELECTION';
export const LOAD_FILES_IN_FOLDER = 'LOAD_FILES_IN_FOLDER';
export const SET_STATS_GAME_PAGE = 'SET_STATS_GAME_PAGE';
export const STORE_SCROLL_POSITION = 'STORE_SCROLL_POSITION';
export const STORE_FILE_LOAD_STATE = 'STORE_FILE_LOAD_STATE';

export function loadRootFolder() {
  return async (dispatch, getState) => {
    const rootFolderPath = electronSettings.get('settings.rootSlpPath');
    if (!rootFolderPath) {
      dispatch({
        type: LOAD_ROOT_FOLDER,
        payload: {
          folderFound: false,
        },
      });
    }

    if (rootFolderPath === getState().fileLoader.rootFolderPath) {
      return;
    }

    const folderFound = await new Promise((resolve, reject) => {
      fs.stat(rootFolderPath, (err, stats) => {
        if (err) {
          reject(err);
        }
        resolve(stats);
      });
    }).then(stats => stats.isDirectory(), () => false);

    if (!folderFound) {
      dispatch({
        type: LOAD_ROOT_FOLDER,
        payload: {
          folderFound: false,
        },
      });
      return;
    }

    dispatch({
      type: LOAD_ROOT_FOLDER,
      payload: {
        folderFound: true,
        rootFolderPath: rootFolderPath,
        rootFolderName: path.basename(rootFolderPath),
      },
    });

    dispatch({
      type: CHANGE_FOLDER_SELECTION,
      payload: {
        folderPath: rootFolderPath,
      },
    });

    // Had to add this wait here otherwise the loading screen would not show
    await wait(10); // eslint-disable-line

    const filesAndFolders = await loadFilesInFolder(rootFolderPath);
    const processedFiles = processFiles(filesAndFolders[0]);

    dispatch({
      type: LOAD_FILES_IN_FOLDER,
      payload: {
        files: processedFiles,
        folders: filesAndFolders[1],
        numFilteredFiles: filesAndFolders[0].length - processedFiles.length,
      },
    });
  };
}

export function changeFolderSelection(folder) {
  return async (dispatch, getState) => {
    dispatch({
      type: CHANGE_FOLDER_SELECTION,
      payload: {
        folderPath: folder,
      },
    });

    // Had to add this wait here otherwise the loading screen would not show
    await wait(10); // eslint-disable-line

    const currentPath = getState().fileLoader.selectedFolderFullPath;
    const filesAndFolders = await loadFilesInFolder(currentPath);
    const processedFiles = processFiles(filesAndFolders[0]);

    dispatch({
      type: LOAD_FILES_IN_FOLDER,
      payload: {
        files: processedFiles,
        folders: filesAndFolders[1],
        numFilteredFiles: filesAndFolders[0].length - processedFiles.length,
      },
    });
  };
}

export function storeScrollPosition(position) {
  return {
    type: STORE_SCROLL_POSITION,
    payload: {
      position: position,
    },
  };
}

export function storeFileLoadState(fileLoadState) {
  return {
    type: STORE_FILE_LOAD_STATE,
    payload: {
      fileLoadState: fileLoadState,
    },
  };
}

export function playFile(file) {
  return async (dispatch, getState) => {
    const filePath = file.fullPath;
    if (!filePath) {
      // TODO: Maybe show error message
      return;
    }

    const dolphinManager = getState().fileLoader.dolphinManager;
    dolphinManager.playFile(filePath).catch((err) => {
      const errorAction = displayError(
        'fileLoader-global',
        err.message,
      );

      dispatch(errorAction);
    });
  };
}

export function queueFiles(files) {
  return (dispatch, getState) => {
    if (!Array.isArray(files) || files.length === 0) {
      return;
    }

    const dolphinManager = getState().fileLoader.dolphinManager;
    dolphinManager.queueFiles(files).catch(err => {
      const errorAction = displayError(
        'fileLoader-global',
        err.message,
      );

      dispatch(errorAction);
    });
  };
}

export function setStatsGamePage(index) {
  return (dispatch, getState) => {
    const files = getState().fileLoader.files;
    let statsGameIndex = index;
    if (statsGameIndex >= files.length) {
      statsGameIndex = 0;
    }

    if (statsGameIndex < 0) {
      statsGameIndex = files.length - 1;
    }

    dispatch({
      type: SET_STATS_GAME_PAGE,
      payload: { statsGameIndex: statsGameIndex },
    })
    gameProfileLoad(files[statsGameIndex].game)(dispatch);
  }
}

async function loadFilesInFolder(folderPath) {
  const readdirPromise = new Promise((resolve, reject) => {
    fs.readdir(folderPath, { withFileTypes: true }, (err, dirents) => {
      if (err) {
        reject(err);
      }
      resolve(dirents);
    });
  });

  const filesPromise = readdirPromise.then(dirents => (
    dirents.filter(dirent => (
      dirent.isFile()
    )).map(dirent => (
      dirent.name
    )).filter(fileName => (
      // Filter for all .slp files
      path.extname(fileName) === ".slp"
    )).map(fileName => {
      // Compute header information for display
      const fullPath = path.join(folderPath, fileName);
      let game = null;
      let hasError = false;

      // Pre-load settings here
      try {
        game = new SlippiGame(fullPath);

        // Preload settings
        const settings = game.getSettings();
        if (_.isEmpty(settings.players)) {
          throw new Error("Game settings could not be properly loaded.");
        }

        // Preload metadata
        game.getMetadata();
      } catch (err) {
        console.log(`Failed to parse file: ${fullPath}`);
        console.log(err);
        hasError = true;
      }

      return {
        fullPath: fullPath,
        fileName: fileName,
        game: game,
        hasError: hasError,
      };
    })
  ));

  const foldersPromise = readdirPromise.then(dirents => (
    dirents.filter(dirent => (
      dirent.isDirectory()
    )).map(dirent => {
      const folderName = dirent.name;
      const fullPath = path.join(folderPath, folderName);
      return {
        fullPath: fullPath,
        folderName: folderName,
        expanded: true,
        subDirectories: [],
      };
    })
  ));

  return Promise.all([filesPromise, foldersPromise]);
}

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function processFiles(files) {
  let resultFiles = files;

  resultFiles = resultFiles.filter(file => {
    if (file.hasError) {
      // This will occur if an error was encountered while parsing
      return false;
    }

    const settings = file.game.getSettings() || {};
    if (!settings.stageId) {
      // I know that right now if you play games from debug mode it make some
      // weird replay files... this should filter those out
      return false;
    }

    const metadata = file.game.getMetadata() || {};
    const totalFrames = metadata.lastFrame || 30 * 60 + 1;
    return totalFrames > 30 * 60;
  });

  resultFiles = _.orderBy(
    resultFiles,
    [
      file => {
        const metadata = file.game.getMetadata() || {};
        const startAt = metadata.startAt;
        return moment(startAt);
      },
      'fileName',
    ],
    ['desc', 'desc']
  );

  // Filter out files that were shorter than 30 seconds
  return resultFiles;
}
