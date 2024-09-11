import * as vscode from 'vscode';

   export function activate(context: vscode.ExtensionContext) {
     console.log('Congratulations, your extension "file-contents-aggregator" is now active!');

     let disposable = vscode.commands.registerCommand('file-contents-aggregator.aggregate', () => {
       vscode.window.showInformationMessage('Aggregating file contents...');
       // Tu by mala byť implementácia agregácie súborov
     });

     context.subscriptions.push(disposable);
   }

   export function deactivate() {}