import * as vscode from 'vscode'

export const PACKAGE_NAME = 'deptrac'
export const PACKAGE_TITLE = 'Deptrac'
export let config: vscode.WorkspaceConfiguration

export function setConfig(): void {
    config = vscode.workspace.getConfiguration(PACKAGE_NAME)
}
