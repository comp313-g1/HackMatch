# ShiftSwap

## Overview

ShiftSwap is a lightweight shift-swapping web app for small businesses such as cafes and bubble tea shops. It helps teams manage schedule changes without forcing every employee to create an account or download a separate app.

## Problem

Tools like 7shifts are useful for larger operations, but they are not well suited for small shops with fast-changing staff. In these businesses, workers often come and go quickly, and many do not want to create another account just to swap a single shift.

As a result, teams often fall back to WhatsApp or LINE group chats. Those chats are fast, but they are messy, and managers frequently miss important schedule updates.

## Solution

ShiftSwap removes the friction. Only the manager needs an account. Employees can access the system using secure links or a simple staff page, so they do not need to register, remember passwords, or install an app.

This creates a smoother experience that keeps the speed of chat-based scheduling while improving reliability and visibility for the manager.

## Core Features

### 1. Zero-Friction Shift Requests

Employees can request a shift swap with a single click. The manager creates the schedule, and employees simply share or use a secure link to claim a shift.

### 2. Shift Swap Flow

The process is simple:

1. The manager creates the weekly schedule.
2. An employee with a conflict clicks a button to generate a swap link.
3. The link is sent in a team chat.
4. A coworker opens the link, selects their name, and claims the shift.
5. The manager reviews the request and approves it.
6. The master schedule updates automatically.

### 3. Race Condition Prevention

If two employees try to claim the same shift at the same time, the system prevents conflicts by locking the database record during the claim process. Only one employee can successfully claim the shift.

### 4. Secure, Expiring Links

Each shift link includes a secure token. It automatically expires once the shift is claimed or when the shift time has passed, preventing unauthorized access or stale requests.

## Difference from Existing Tools

The major problem with many scheduling systems is that everyone has to sign up and download an app. For small businesses with student or part-time workers, that adds unnecessary friction.

ShiftSwap is designed specifically for that reality. It keeps the convenience of quick group chat communication, while making the process safer and more organized with real scheduling logic behind it.

Rather than making the entire team create accounts, ShiftSwap keeps the account requirement on the manager and gives employees a simple, secure way to participate.

## Two Access Methods

### Method A: Magic Link

This option works like a shared document link. When a manager adds an employee, the backend creates a random token. The employee receives a URL such as app.com/my-schedule?token=xyz123.

When the employee opens the link, the frontend stores the token in localStorage. The next time they return, the browser automatically loads their schedule without sign-in.

This creates a true zero-friction experience and is fast to implement.

### Method B: Name + 4-Digit PIN

This option works like a POS terminal. A single staff page at /staff contains a dropdown for employee names and a 4-digit PIN field.

The worker selects their name, enters their PIN, and views their schedule. This is useful if a worker clears browser data or loses their link, because they can still access their schedule without contacting the manager.

## Conclusion

ShiftSwap brings the speed of group chats together with the reliability of a real scheduling database. It reduces friction for employees, improves visibility for managers, and creates a safer, more efficient way to handle shift swaps in small businesses.
