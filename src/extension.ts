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

    let disposable = vscode.commands.registerCommand('file-contents-aggregator.aggregate', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }

        const rootPath = workspaceFolders[0].uri.fsPath;
        const outputPath = path.join(rootPath, 'aggregated_contents.txt');

        try {
            const config = getConfiguration();
            const fileContents = await aggregateContents(rootPath, config);
            fs.writeFileSync(outputPath, fileContents);
            vscode.window.showInformationMessage(`File contents aggregated in ${outputPath}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Error aggregating file contents: ${error}`);
        }
    });

    context.subscriptions.push(disposable);
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

async function aggregateContents(rootPath: string, config: AggregatorConfig): Promise<string> {
    let contents = '';
    const aggregationStartPath = path.join(rootPath, config.aggregationStartPath);
    const aggregationFiles = await getFiles(aggregationStartPath, config.ignoredPaths);

    if (config.generateTreeStructure) {
        const treeStartPath = path.join(rootPath, config.treeStartPath);
        const treeFiles = await getFiles(treeStartPath, config.ignoredPaths);
        contents += generateTreeStructure(treeStartPath, treeFiles) + '\n\n';
    }

    for (const file of aggregationFiles) {
        const relativePath = vscode.workspace.asRelativePath(file);
        const fileContent = await vscode.workspace.fs.readFile(file);
        
        if (config.includeFileHeaders) {
            contents += `\n--- ${relativePath} ---\n\n`;
        }
        
        contents += fileContent.toString() + '\n\n';
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