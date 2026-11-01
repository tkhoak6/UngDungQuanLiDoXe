@echo off
REM parking-desktop launcher — double-click de mo app, khong can go lenh.
REM Yeu cau: Node o C:\Program Files\nodejs, npm.cmd goi qua cmd (tranh loi ExecutionPolicy cua PowerShell).
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d D:\DA
call npm.cmd run dev
if errorlevel 1 pause
