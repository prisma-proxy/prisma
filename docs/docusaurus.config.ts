import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const repoUrl = 'https://github.com/prisma-proxy/prisma';

const config: Config = {
  title: 'Prisma Proxy',
  tagline: 'Next-generation encrypted proxy infrastructure built in Rust',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://yamimega.github.io/',
  baseUrl: '/prisma',

  onBrokenLinks: 'warn',

  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'zh-Hans'],
    localeConfigs: {
      en: {label: 'English'},
      'zh-Hans': {label: '简体中文'},
    },
  },

  themes: [
    '@docusaurus/theme-mermaid',
    [
      require.resolve('@easyops-cn/docusaurus-search-local'),
      {
        hashed: true,
        language: ['en', 'zh'],
        indexBlog: false,
        docsRouteBasePath: '/docs',
      },
    ],
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: `${repoUrl}/edit/master/docs/`,
          showLastUpdateTime: true,
          lastVersion: 'current',
          versions: {
            current: {label: 'v2.26.0', path: ''},
          },
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  plugins: [
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'guide',
        path: 'guide',
        routeBasePath: 'guide',
        sidebarPath: './sidebarsGuide.ts',
        editUrl: `${repoUrl}/edit/master/docs/`,
      },
    ],
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'dev',
        path: 'dev',
        routeBasePath: 'dev',
        sidebarPath: './sidebarsDev.ts',
        editUrl: `${repoUrl}/edit/master/docs/`,
      },
    ],
  ],

  themeConfig: {
    mermaid: {
      theme: {light: 'neutral', dark: 'dark'},
    },
    tableOfContents: {
      minHeadingLevel: 2,
      maxHeadingLevel: 4,
    },
    colorMode: {
      defaultMode: 'dark',
      disableSwitch: false,
      respectPrefersColorScheme: false,
    },
    navbar: {
      title: 'Prisma Proxy',
      logo: {alt: 'Prisma Proxy Logo', src: 'img/logo.svg'},
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          to: '/guide/',
          label: 'Guide',
          position: 'left',
        },
        {
          to: '/benchmarks',
          label: 'Benchmarks',
          position: 'left',
        },
        {
          to: '/dev/',
          label: 'Dev',
          position: 'left',
        },
        {
          type: 'localeDropdown',
          position: 'right',
        },
        {
          href: repoUrl,
          position: 'right',
          className: 'header-github-link',
          'aria-label': 'GitHub repository',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Documentation',
          items: [
            {
              label: 'Getting Started',
              to: '/docs/getting-started',
            },
            {
              label: 'Configuration',
              to: '/docs/configuration/server',
            },
            {
              label: 'CLI Reference',
              to: '/docs/cli-reference',
            },
          ],
        },
        {
          title: 'Deployment',
          items: [
            {
              label: 'Docker',
              to: '/docs/deployment/docker',
            },
            {
              label: 'Linux (systemd)',
              to: '/docs/deployment/linux-systemd',
            },
            {
              label: 'Cloudflare CDN',
              to: '/docs/deployment/cloudflare-cdn',
            },
          ],
        },
        {
          title: 'Security',
          items: [
            {
              label: 'PrismaVeil Protocol',
              to: '/docs/security/prismaveil-protocol',
            },
            {
              label: 'Cryptography',
              to: '/docs/security/cryptography',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'GitHub',
              href: repoUrl,
            },
          ],
        },
      ],
      copyright: `Copyright \u00A9 ${new Date().getFullYear()} Prisma Proxy.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['toml', 'bash', 'rust', 'powershell', 'json'],
      magicComments: [
        {
          className: 'theme-code-block-highlighted-line',
          line: 'highlight-next-line',
          block: {start: 'highlight-start', end: 'highlight-end'},
        },
        {
          className: 'code-block-error-line',
          line: 'This is an error',
        },
      ],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
