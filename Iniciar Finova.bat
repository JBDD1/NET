@echo off
title Finova — Servidor local
color 0B
echo.
echo  Iniciando Finova...
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  ERROR: Node.js no esta instalado.
    echo  Descargalo en: https://nodejs.org
    echo.
    pause
    exit /b 1
)

REM ──────────────────────────────────────────────────────────────
REM  CONFIGURACION IA (opcional)
REM  Para activar el Asesor IA sin que los usuarios necesiten
REM  su propia API Key, elige UNA opcion y descomenta la linea:
REM
REM  OPCION A — Groq (GRATIS, sin tarjeta):
REM  Obtén tu clave en console.groq.com → API Keys
REM  set FINOVA_GROQ_KEY=gsk_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
REM
REM  OPCION B — Claude (de pago, mayor calidad):
REM  Obtén tu clave en console.anthropic.com → API Keys
REM  set FINOVA_CLAUDE_KEY=sk-ant-api03-XXXXXXXXXXXXXXXXXXXXXXXX
REM
REM  Solo descomenta UNA linea (quita el REM al principio).
REM ──────────────────────────────────────────────────────────────

node "%~dp0server.js"
pause
