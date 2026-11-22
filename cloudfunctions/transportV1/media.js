'use strict';
const { uploadArchive, signIncoming } = require('./archive-upload');
// Renderer and font are copied from the verified image probe during packaging.
// Lazy import keeps invitation/read operations available if native image loading fails.
function createMedia(cloud) {
  return {
    download: async fileID => (await cloud.downloadFile({ fileID })).fileContent,
    upload: uploadArchive,
    signUpload: signIncoming,
    render: (buffer, context) => require('./image/renderer').render(buffer, context),
    links: async fileIDs => {
      const response = await cloud.getTempFileURL({ fileList: fileIDs });
      return Object.fromEntries(response.fileList.filter(file => file.tempFileURL && !file.status)
        .map(file => [file.fileID, file.tempFileURL]));
    },
  };
}
module.exports = { createMedia };
