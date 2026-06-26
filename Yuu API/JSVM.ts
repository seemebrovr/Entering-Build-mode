import { DirectoryBasePaths, Files } from "./Files";


// Need to know which VMs were opened by a VM, and close them when that VM is closed

export class JSVM {
  vmID: number | undefined;
  isRunning: boolean;

  constructor(baseJSDirPath: DirectoryBasePaths, subJSDirPath: string) {
    this.vmID = Godot.files.folder.createJSVM(Files.utils.combineBaseAndSubPaths(baseJSDirPath, subJSDirPath));

    this.isRunning = (this.vmID !== undefined);
  }

  destroy() {
    if (this.isRunning && this.vmID !== undefined) {
      Godot.files.folder.closeJSVM(this.vmID);
    }
  }
}