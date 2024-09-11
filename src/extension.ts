import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

interface AggregatorConfig {
    ignoredPaths: string[];
    includeFileHeaders: boolean;
    generateTreeStructure: boolean;
    treeStartPath: string;
    aggregationStartPath: string;
    fileExtensions: string[];
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

    let config: AggregatorConfig | undefined = getConfiguration();
    
    // Interactive options
    config = await getInteractiveOptions(config, customStartPath);
    if (!config) {return;}; // User cancelled

    const rootPath = await selectWorkspaceFolder(workspaceFolders);
    if (!rootPath) {return;}; // User cancelled

    const outputPath = await selectOutputFile(rootPath);
    if (!outputPath) {return;}; // User cancelled

    try {
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
        aggregationStartPath: config.get('aggregationStartPath', './src'),
        fileExtensions: config.get('fileExtensions', [])
    };
}

async function getInteractiveOptions(config: AggregatorConfig, customStartPath?: string): Promise<AggregatorConfig | undefined> {
  const options: vscode.QuickPickItem[] = [
      { label: 'Include file headers', picked: config.includeFileHeaders },
      { label: 'Generate tree structure', picked: config.generateTreeStructure },
      { label: 'Specify file extensions to include' }
  ];

  const selectedOptions = await vscode.window.showQuickPick(options, {
      canPickMany: true,
      placeHolder: 'Select options for aggregation'
  });

  if (!selectedOptions) {return undefined;} // User cancelled

  config.includeFileHeaders = selectedOptions.some(option => option.label === 'Include file headers');
  config.generateTreeStructure = selectedOptions.some(option => option.label === 'Generate tree structure');

  if (selectedOptions.some(option => option.label === 'Specify file extensions to include')) {
      const extensions = await vscode.window.showInputBox({
          prompt: 'Enter file extensions to include (comma-separated, e.g., js,ts,py)',
          value: config.fileExtensions.join(',')
      });
      if (extensions !== undefined) {
          config.fileExtensions = extensions.split(',').map(ext => ext.trim()).filter(ext => ext !== '');
      }
  }

  if (customStartPath) {
      config.aggregationStartPath = customStartPath;
  } else {
      config.aggregationStartPath = await getAggregationPath(config.aggregationStartPath);
  }

  return config;
}

async function getAggregationPath(defaultPath: string): Promise<string> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
      return defaultPath;
  }

  const rootPath = workspaceFolders[0].uri.fsPath;

  return new Promise((resolve) => {
      const quickPick = vscode.window.createQuickPick();
      quickPick.placeholder = 'Enter the starting path for aggregation (relative to workspace root)';
      quickPick.value = defaultPath;
      quickPick.items = [{ label: defaultPath }];

      quickPick.onDidChangeValue(async (value) => {
          const completions = await getPathCompletions(rootPath, value);
          quickPick.items = completions.map(completion => ({ label: completion }));
      });

      quickPick.onDidAccept(() => {
          const selectedPath = quickPick.selectedItems[0]?.label || quickPick.value;
          resolve(selectedPath);
          quickPick.hide();
      });

      quickPick.show();
  });
}

async function getPathCompletions(rootPath: string, currentInput: string): Promise<string[]> {
  // Ensure the input starts with './'
  if (!currentInput.startsWith('./')) {
      currentInput = './' + currentInput;
  }

  const fullPath = path.join(rootPath, currentInput);
  let dir = path.dirname(fullPath);

  // If the current input ends with '/', we want to show contents of that directory
  if (currentInput.endsWith('/')) {
      dir = fullPath;
  }

  try {
      const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir));
      const completions = files
          .filter(([name, type]) => type === vscode.FileType.Directory)
          .map(([name]) => {
              let relativePath = path.join(path.relative(rootPath, dir), name);
              // Ensure the path starts with './'
              if (!relativePath.startsWith('./')) {
                  relativePath = './' + relativePath;
              }
              // Add trailing slash to indicate it's a directory
              return relativePath + '/';
          })
          .filter(relativePath => relativePath.toLowerCase().startsWith(currentInput.toLowerCase()));

      return completions;
  } catch (error) {
      console.error('Error getting path completions:', error);
      return [];
  }
}

async function selectWorkspaceFolder(workspaceFolders: readonly vscode.WorkspaceFolder[]): Promise<string | undefined> {
    if (workspaceFolders.length === 1) {
        return workspaceFolders[0].uri.fsPath;
    }

    const selected = await vscode.window.showQuickPick(
        workspaceFolders.map(folder => ({ label: folder.name, description: folder.uri.fsPath })),
        { placeHolder: 'Select workspace folder' }
    );

    return selected ? selected.description : undefined;
}

async function selectOutputFile(rootPath: string): Promise<string | undefined> {
    const defaultUri = vscode.Uri.file(path.join(rootPath, 'aggregated_contents.txt'));
    const options: vscode.SaveDialogOptions = {
        defaultUri: defaultUri,
        filters: {
            'Text files': ['txt'],
            'All files': ['*']
        }
    };

    const uri = await vscode.window.showSaveDialog(options);
    return uri ? uri.fsPath : undefined;
}

async function aggregateContents(rootPath: string, config: AggregatorConfig, progress: vscode.Progress<{ message?: string; increment?: number }>, token: vscode.CancellationToken): Promise<string> {
    let contents = '';
    const aggregationStartPath = path.join(rootPath, config.aggregationStartPath);
    const aggregationFiles = await getFiles(aggregationStartPath, config.ignoredPaths, config.fileExtensions);

    if (config.generateTreeStructure) {
        const treeStartPath = path.join(rootPath, config.treeStartPath);
        const treeFiles = await getFiles(treeStartPath, config.ignoredPaths, config.fileExtensions);
        contents += generateTreeStructure(treeStartPath, treeFiles) + '\n\n';
    }

    const totalFiles = aggregationFiles.length;
    const chunkSize = 100; // Process files in chunks to optimize performance
    for (let i = 0; i < totalFiles; i += chunkSize) {
        if (token.isCancellationRequested) {
            return '';
        }

        const chunk = aggregationFiles.slice(i, i + chunkSize);
        const chunkContents = await Promise.all(chunk.map(async (file) => {
            const relativePath = vscode.workspace.asRelativePath(file);
            const fileContent = await vscode.workspace.fs.readFile(file);
            let fileString = '';
            if (config.includeFileHeaders) {
                fileString += `\n--- ${relativePath} ---\n\n`;
            }
            fileString += fileContent.toString() + '\n\n';
            return fileString;
        }));

        contents += chunkContents.join('');
        progress.report({ message: `Processing files ${i + 1} to ${Math.min(i + chunkSize, totalFiles)} of ${totalFiles}`, increment: (chunkSize / totalFiles) * 100 });
    }

    return contents;
}

async function getFiles(startPath: string, ignoredPaths: string[], fileExtensions: string[]): Promise<vscode.Uri[]> {
    const includePattern = new vscode.RelativePattern(startPath, fileExtensions.length > 0 ? `**/*.{${fileExtensions.join(',')}}` : '**/*');
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