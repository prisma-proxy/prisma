---
sidebar_position: 1
slug: /guide
---

# Beginner's Guide

Welcome to the Prisma Beginner's Guide! If you have never used a proxy, never configured a server, or even if the word "encryption" sounds intimidating -- this guide is for you.

We will walk you through everything **from scratch**, step by step, with plenty of explanations, analogies, and diagrams. By the end of this guide, you will have a fully working Prisma setup that keeps your internet traffic private and secure.

## What is Prisma?

Prisma is a tool that creates an **encrypted tunnel** between your computer and a server somewhere on the internet. All your internet traffic travels through this tunnel, so nobody in between -- not your ISP, not your school or office network, not anyone -- can see what you are doing online.

Think of it like this:

> Imagine you are sending a letter to a friend, but you don't want the mailman to read it. So you put your letter inside a **locked box**, and only your friend has the key. That is essentially what Prisma does with your internet traffic.

## Why would you need Prisma?

There are many reasons people use tools like Prisma:

- **Privacy** -- Keep your browsing activity private from your internet provider
- **Security** -- Protect your data on public Wi-Fi (coffee shops, airports, hotels)
- **Access** -- Reach websites and services that might be blocked on your network
- **Freedom** -- Bypass internet censorship and filtering

## What you will learn

This guide covers everything from the very basics to a fully working setup:

| Chapter | What you will learn |
|---------|-------------------|
| [Understanding the Basics](./basics.md) | How the internet works, what proxies and encryption are |
| [How Prisma Works](./how-prisma-works.md) | Prisma's architecture and what makes it special |
| [Preparation](./prepare.md) | What you need and how to get ready |
| [Installing the Server](./install-server.md) | Setting up Prisma on your server |
| [Configuring the Server](./configure-server.md) | Writing the server configuration file |
| [Installing the Client](./install-client.md) | Setting up Prisma on your computer or phone |
| [Configuring the Client](./configure-client.md) | Writing the client configuration file |
| [Your First Connection](./first-connection.md) | Connecting everything and verifying it works |
| [Going Further](./advanced-setup.md) | Routing rules, CDN, optimization, and more |

## Prerequisites

You only need two things:

1. **A computer** -- Windows, macOS, or Linux
2. **An internet connection**

That is it. We will explain everything else as we go.

:::tip No experience needed
This guide assumes **zero** prior knowledge about networking, servers, or the command line. Every concept is explained from the ground up. If something is unclear, it is our fault, not yours.
:::

## How to use this guide

- **Read in order** -- Each chapter builds on the previous one
- **Don't skip the basics** -- Even if you are tempted, the [basics chapter](./basics.md) will help you understand everything that comes after
- **Try things out** -- The best way to learn is by doing. Follow along with the examples
- **Don't worry about mistakes** -- Nothing in this guide can break your computer. If something goes wrong, you can always start over

Ready? Let's begin with [Understanding the Basics](./basics.md).
