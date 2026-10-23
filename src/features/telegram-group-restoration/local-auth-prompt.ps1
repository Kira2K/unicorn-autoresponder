param([Parameter(Mandatory=$true)][string]$PipeName,[Parameter(Mandatory=$true)][string]$Label)
Add-Type -AssemblyName System.Windows.Forms
$form=New-Object System.Windows.Forms.Form
$form.Text='Local Telegram sign-in'
$form.Width=430;$form.Height=185;$form.StartPosition='CenterScreen';$form.TopMost=$true
$labelControl=New-Object System.Windows.Forms.Label
$labelControl.Text=$Label;$labelControl.Left=15;$labelControl.Top=15;$labelControl.Width=380
$inputControl=New-Object System.Windows.Forms.TextBox
$inputControl.Left=15;$inputControl.Top=45;$inputControl.Width=380;$inputControl.UseSystemPasswordChar=$true
$ok=New-Object System.Windows.Forms.Button
$ok.Text='Continue';$ok.Left=285;$ok.Top=80;$ok.Width=110;$ok.DialogResult=[System.Windows.Forms.DialogResult]::OK
$form.Controls.AddRange(@($labelControl,$inputControl,$ok));$form.AcceptButton=$ok
$result=$form.ShowDialog();$answer=if($result -eq [System.Windows.Forms.DialogResult]::OK){$inputControl.Text}else{''}
$pipe=New-Object System.IO.Pipes.NamedPipeClientStream('.', $PipeName, [System.IO.Pipes.PipeDirection]::Out)
try{$pipe.Connect(10000);$writer=New-Object System.IO.StreamWriter($pipe,[System.Text.UTF8Encoding]::new($false));$writer.Write($answer);$writer.Flush();$inputControl.Clear();$answer=''}finally{$pipe.Dispose();$form.Dispose()}
