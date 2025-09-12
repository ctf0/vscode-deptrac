import {execa, ExecaError} from 'execa'
import * as vscode from 'vscode'
import * as utils from './utils'

let ws: string
let diagnosticCollection: vscode.DiagnosticCollection

export async function activate(context: vscode.ExtensionContext) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.at(0)

    if (!workspaceFolder) {
        return
    }

    ws = workspaceFolder.uri.fsPath
    diagnosticCollection = vscode.languages.createDiagnosticCollection(utils.PACKAGE_NAME)

    utils.setConfig()
    await progressAnalyze()

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration(utils.PACKAGE_NAME)) {
                utils.setConfig()
            }
        }),
        watchForConfigFileChanges(workspaceFolder),
        diagnosticCollection,
        vscode.commands.registerCommand(`${utils.PACKAGE_NAME}.analyze`, async() => await progressAnalyze()),
        vscode.workspace.onDidSaveTextDocument(async(doc: vscode.TextDocument) => {
            if (doc.languageId == 'php') {
                await progressAnalyze()
            }
        }),
    )
}

function watchForConfigFileChanges(workspaceFolder: vscode.WorkspaceFolder) {
    const pattern = new vscode.RelativePattern(workspaceFolder, utils.config.get('watchGlob'))
    const watcher = vscode.workspace.createFileSystemWatcher(pattern)

    return watcher.onDidChange(async() => await progressAnalyze())
}

function progressAnalyze() {
    return vscode.window.withProgress({
        location    : vscode.ProgressLocation.Notification,
        cancellable : false,
        title       : `${utils.PACKAGE_TITLE}: Analyzing Please Wait`,
    }, async(progress: any) => {
        await runAnalysis(progress)
    })
}

async function runAnalysis(progress: any = null) {
    let output: any = '{}'

    try {
        const cmnd = prepareCommand()
        const {stdout} = await execa(cmnd, {
            cwd   : ws,
            shell : vscode.env.shell,
        })

        output = stdout
    } catch (error: any) {
        if (error instanceof ExecaError) {
            const stdout = error.stdout
            const stderr = error.stderr

            if (stderr && !stdout) {
                progress?.report({
                    increment : 100,
                })

                vscode.window.showErrorMessage(`${utils.PACKAGE_TITLE}: ${error.stderr}`)

                return Promise.resolve()
            }

            if (stdout) {
                output = stdout
            }
        } else {
            progress?.report({
                message   : error.message,
                increment : 100,
            })

            return Promise.resolve()
        }
    }

    output = JSON.parse(output)

    return handle(output, progress)
}

function prepareCommand() {
    const phpCommand = utils.config.get('phpCommand')
    const toolCommand = utils.config.get('command')

    return `${phpCommand} ${toolCommand}`
}

function handle(output: any, progress: any = null) {
    diagnosticCollection.clear()

    let msg = 'done'
    const violationCount = output.Report?.Violations || 0

    if (violationCount > 0) {
        msg = `found ${violationCount} violations`
    }

    return processOutput(output).finally(() => {
        progress?.report({
            message   : msg,
            increment : 100,
        })
    })
}

function processOutput(output: any) {
    return new Promise((resolve) => {
        if (!Object.keys(output.files).length) {
            return resolve(false)
        }

        const diagnosticsByFile = new Map<string, vscode.Diagnostic[]>()

        for (const [filePath, fileData] of Object.entries(output.files)) {
            const fileDiagnostics: vscode.Diagnostic[] = []

            if (fileData && typeof fileData === 'object' && 'messages' in fileData) {
                const messages = fileData.messages as Array<{message: string, line: number, type: string}>

                for (const msg of messages) {
                    const line = Math.max(0, msg.line - 1)
                    const range = new vscode.Range(
                        new vscode.Position(line, 0),
                        new vscode.Position(line, msg.message.length),
                    )

                    let severity: vscode.DiagnosticSeverity

                    switch (msg.type.toLowerCase()) {
                        case 'error':
                            severity = vscode.DiagnosticSeverity.Error
                            break
                        case 'warning':
                            severity = vscode.DiagnosticSeverity.Warning
                            break
                        default:
                            severity = vscode.DiagnosticSeverity.Information
                    }

                    const diagnostic = new vscode.Diagnostic(
                        range,
                        msg.message,
                        severity,
                    )
                    diagnostic.source = utils.PACKAGE_TITLE

                    fileDiagnostics.push(diagnostic)
                }
            }

            if (fileDiagnostics.length > 0) {
                diagnosticsByFile.set(
                    filePath.replace(utils.config.get('dockerVolumePath'), ws),
                    fileDiagnostics,
                )
            }
        }

        for (const [filePath, diagnostics] of diagnosticsByFile.entries()) {
            diagnosticCollection.set(vscode.Uri.file(filePath), diagnostics)
        }

        resolve(true)
    })
}

export function deactivate() {
}
