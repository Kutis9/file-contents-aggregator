import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface AggregatorConfig {
    ignoredPaths: string[];
    includeFileHeaders: boolean;
    generateTreeStructure: boolean;
    treeStartPath: string;
    aggregationStartPath: string;
}

export function activate(context: vscode.ExtensionContext) {
    console.log('File Contents Aggregator is now active!');

    let aggregateCommand = vscode.commands.registerCommand('file-contents-aggregator.aggregate', () => aggregate());
    let aggregateFromContextCommand = vscode.commands.registerCommand('file-contents-aggregator.aggregateFromContext', (uri: vscode.Uri) => aggregateFromContext(uri));

    context.subscriptions.push(aggregateCommand, aggregateFromContextCommand);
}

async function aggregate(customStartPath?: string) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
    }

    const rootPath = workspaceFolders[0].uri.fsPath;
    const outputPath = path.join(rootPath, 'aggregated_contents.txt');

    try {
        const config = getConfiguration();
        if (customStartPath) {
            config.aggregationStartPath = path.relative(rootPath, customStartPath);
        }
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Aggregating file contents",
            cancellable: true
        }, async (progress, token) => {
            const fileContents = await aggregateContents(rootPath, config, progress, token);
            if (token.isCancellationRequested) {
                return;
            }
            fs.writeFileSync(outputPath, fileContents);
            vscode.window.showInformationMessage(`File contents aggregated in ${outputPath}`);
        });
    } catch (error) {
        vscode.window.showErrorMessage(`Error aggregating file contents: ${error}`);
    }
}

async function aggregateFromContext(uri: vscode.Uri) {
    await aggregate(uri.fsPath);
}

function getConfiguration(): AggregatorConfig {
    const config = vscode.workspace.getConfiguration('fileContentsAggregator');
    return {
        ignoredPaths: config.get('ignoredPaths', ['**/node_modules/**', '**/.git/**']),
        includeFileHeaders: config.get('includeFileHeaders', true),
        generateTreeStructure: config.get('generateTreeStructure', false),
        treeStartPath: config.get('treeStartPath', './'),
        aggregationStartPath: config.get('aggregationStartPath', './src')
    };
}

async function aggregateContents(rootPath: string, config: AggregatorConfig, progress: vscode.Progress<{ message?: string; increment?: number }>, token: vscode.CancellationToken): Promise<string> {
    let contents = '';
    const aggregationStartPath = path.join(rootPath, config.aggregationStartPath);
    const aggregationFiles = await getFiles(aggregationStartPath, config.ignoredPaths);

    if (config.generateTreeStructure) {
        const treeStartPath = path.join(rootPath, config.treeStartPath);
        const treeFiles = await getFiles(treeStartPath, config.ignoredPaths);
        contents += generateTreeStructure(treeStartPath, treeFiles) + '\n\n';
    }

    const totalFiles = aggregationFiles.length;
    for (let i = 0; i < totalFiles; i++) {
        if (token.isCancellationRequested) {
            return '';
        }

        const file = aggregationFiles[i];
        const relativePath = vscode.workspace.asRelativePath(file);
        const fileContent = await vscode.workspace.fs.readFile(file);
        
        if (config.includeFileHeaders) {
            contents += `\n--- ${relativePath} ---\n\n`;
        }
        
        contents += fileContent.toString() + '\n\n';

        progress.report({ message: `Processing file ${i + 1} of ${totalFiles}`, increment: 100 / totalFiles });
    }

    return contents;
}

async function getFiles(startPath: string, ignoredPaths: string[]): Promise<vscode.Uri[]> {
    const includePattern = new vscode.RelativePattern(startPath, '**/*');
    const excludePattern = `{${ignoredPaths.join(',')}}`;
    
    try {
        return await vscode.workspace.findFiles(includePattern, excludePattern);
    } catch (err) {
        vscode.window.showErrorMessage(`Error finding files: ${err}`);
        return [];
    }
}

interface TreeNode {
  [key: string]: TreeNode;
}

function generateTreeStructure(startPath: string, files: vscode.Uri[]): string {
  const rootName = path.basename(startPath);
  const fileStructure: TreeNode = {};

  files.forEach(file => {
      const relativePath = path.relative(startPath, file.fsPath);
      const parts = relativePath.split(path.sep);
      let currentLevel = fileStructure;

      parts.forEach((part, index) => {
          if (index === parts.length - 1) {
              currentLevel[part] = {};
          } else {
              if (!currentLevel[part]) {
                  currentLevel[part] = {};
              }
              currentLevel = currentLevel[part];
          }
      });
  });

  function renderTree(node: TreeNode, prefix: string = ''): string {
      let result = '';
      const entries = Object.entries(node);
      entries.forEach(([key, value], index) => {
          const isLast = index === entries.length - 1;
          const newPrefix = prefix + (isLast ? '    ' : '│   ');
          result += `${prefix}${isLast ? '└── ' : '├── '}${key}\n`;
          if (Object.keys(value).length > 0) {
              result += renderTree(value, newPrefix);
          }
      });
      return result;
  }

  return `${rootName}\n${renderTree(fileStructure)}`;
}

export function deactivate() {}