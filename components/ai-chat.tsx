"use client";

/**
 * AI Chat Component
 *
 * AI SDK v6 CHAT ARCHITECTURE
 * ===========================
 *
 * This component demonstrates the v6 patterns for building chat UIs with agents:
 *
 * 1. useChat hook - Manages chat state and message streaming
 * 2. Message parts - Each message has typed parts (text, tool calls, etc.)
 * 3. Tool invocations - Handle tool states (loading, approval, ready)
 * 4. Tool approval UI - Human-in-the-loop for sensitive operations
 * 5. Message editing - Re-submit edited messages and regenerate from that point
 * 6. Chat history - Persist conversations to localStorage
 *
 * HOW TO ADD TOOL UI COMPONENTS:
 * ------------------------------
 * 1. Create a component in /components/tools/
 * 2. Import it and add a case to the renderToolInvocation function
 * 3. The component receives the typed tool invocation with input/output
 */

import React from "react";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import type { UIMessage } from "ai";
import type { ChatAgentUIMessage, ModelTier } from "@/agents";
import * as kb from "@/knowledge";
import { getApiKeys, hasApiKeys, type StoredApiKeys } from "@/lib/api-keys";
import { useSession } from "@/lib/auth-client";
import { 
  getFreeChatsRemaining, 
  incrementFreeChatCount, 
  hasFreeChatRemaining,
  needsApiKey 
} from "@/lib/free-trial";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { gruvboxDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { cn } from "@/lib/utils";

// React Icons - import icons for UI components AND the inline icon map
// Ionicons (Io5) - Primary icon set
import { 
  IoArrowUp,
  IoArrowDown,
  IoArrowForward,
  IoArrowBack,
  IoGlobeOutline,
  IoClose,
  IoDocumentText,
  IoChevronDown,
  IoChevronUp,
  IoChevronForward,
  IoChevronBack,
  IoCheckmark,
  IoCheckmarkCircle,
  IoAlertCircle,
  IoPencil,
  IoRefresh,
  IoExpand,
  IoContract,
  IoCopy,
  IoCheckmarkDone,
  IoTerminal,
  IoOpenOutline,
  IoReload,
  IoHeart,
  IoHeartOutline,
  IoStar,
  IoStarOutline,
  IoHome,
  IoHomeOutline,
  IoSettings,
  IoSettingsOutline,
  IoSearch,
  IoSearchOutline,
  IoAdd,
  IoRemove,
  IoTrash,
  IoTrashOutline,
  IoCreate,
  IoCreateOutline,
  IoSave,
  IoSaveOutline,
  IoDownload,
  IoDownloadOutline,
  IoCloudUpload,
  IoCloudUploadOutline,
  IoFolder,
  IoFolderOutline,
  IoFolderOpen,
  IoFolderOpenOutline,
  IoDocument,
  IoDocumentOutline,
  IoMail,
  IoMailOutline,
  IoSend,
  IoSendOutline,
  IoNotifications,
  IoNotificationsOutline,
  IoWarning,
  IoWarningOutline,
  IoInformationCircle,
  IoInformationCircleOutline,
  IoHelpCircle,
  IoHelpCircleOutline,
  IoTime,
  IoTimeOutline,
  IoCalendar,
  IoCalendarOutline,
  IoLocation,
  IoLocationOutline,
  IoPerson,
  IoPersonOutline,
  IoPeople,
  IoPeopleOutline,
  IoLockClosed,
  IoLockClosedOutline,
  IoLockOpen,
  IoLockOpenOutline,
  IoKey,
  IoKeyOutline,
  IoLink,
  IoLinkOutline,
  IoCode,
  IoCodeOutline,
  IoGitBranch,
  IoGitBranchOutline,
  IoPlayCircle,
  IoPlayCircleOutline,
  IoPause,
  IoPauseCircle,
  IoStop,
  IoStopCircle,
  IoMusicalNotes,
  IoCamera,
  IoCameraOutline,
  IoImage,
  IoImageOutline,
  IoVideocam,
  IoVideocamOutline,
  IoMic,
  IoMicOutline,
  IoVolumeHigh,
  IoVolumeMedium,
  IoVolumeLow,
  IoVolumeMute,
  IoBulb,
  IoBulbOutline,
  IoFlash,
  IoFlashOutline,
  IoThumbsUp,
  IoThumbsUpOutline,
  IoThumbsDown,
  IoThumbsDownOutline,
  IoTrophy,
  IoTrophyOutline,
  IoRibbon,
  IoRibbonOutline,
  IoFlag,
  IoFlagOutline,
  IoBookmark,
  IoBookmarkOutline,
  IoBook,
  IoBookOutline,
  IoNewspaper,
  IoNewspaperOutline,
  IoList,
  IoListOutline,
  IoGrid,
  IoGridOutline,
  IoMenu,
  IoMenuOutline,
  IoEllipsisHorizontal,
  IoEllipsisVertical,
  IoShare,
  IoShareOutline,
  IoEye,
  IoEyeOutline,
  IoEyeOff,
  IoEyeOffOutline,
  IoFingerPrint,
  IoShield,
  IoShieldCheckmark,
  IoSparkles,
  IoColorPalette,
  IoColorPaletteOutline,
  IoBrush,
  IoBrushOutline,
  IoConstruct,
  IoConstructOutline,
  IoHammer,
  IoHammerOutline,
  IoBuild,
  IoBuildOutline,
  IoAnalytics,
  IoAnalyticsOutline,
  IoBarChart,
  IoBarChartOutline,
  IoPieChart,
  IoPieChartOutline,
  IoTrendingUp,
  IoTrendingDown,
  IoCart,
  IoCartOutline,
  IoPricetag,
  IoPricetagOutline,
  IoWallet,
  IoWalletOutline,
  IoCard,
  IoCardOutline,
  IoCash,
  IoCashOutline,
  IoGift,
  IoGiftOutline,
  IoPlanet,
  IoPlanetOutline,
  IoRocket,
  IoRocketOutline,
  IoAirplane,
  IoAirplaneOutline,
  IoCar,
  IoCarOutline,
  IoBicycle,
  IoWalk,
  IoFitness,
  IoFitnessOutline,
  IoMedical,
  IoMedicalOutline,
  IoPulse,
  IoNutrition,
  IoLeaf,
  IoLeafOutline,
  IoWater,
  IoWaterOutline,
  IoSunny,
  IoSunnyOutline,
  IoMoon,
  IoMoonOutline,
  IoCloud,
  IoCloudOutline,
  IoRainy,
  IoRainyOutline,
  IoSnow,
  IoSnowOutline,
  IoThunderstorm,
  IoSchool,
  IoSchoolOutline,
  IoBriefcase,
  IoBriefcaseOutline,
  IoStorefront,
  IoStorefrontOutline,
  IoRestaurant,
  IoRestaurantOutline,
  IoCafe,
  IoCafeOutline,
  IoBeer,
  IoBeerOutline,
  IoWine,
  IoWineOutline,
  IoPizza,
  IoFastFood,
  IoGameController,
  IoGameControllerOutline,
  IoDice,
  IoDiceOutline,
  IoExtensionPuzzle,
  IoExtensionPuzzleOutline,
  IoAccessibility,
  IoAccessibilityOutline,
  IoHappy,
  IoHappyOutline,
  IoSad,
  IoSadOutline,
  IoSkull,
  IoSkullOutline,
  IoPaw,
  IoPawOutline,
  IoBug,
  IoBugOutline,
  IoLogoGithub,
  IoLogoTwitter,
  IoLogoLinkedin,
  IoLogoDiscord,
  IoLogoSlack,
  IoLogoPython,
  IoLogoJavascript,
  IoLogoReact,
  IoLogoNodejs,
  IoLogoApple,
  IoLogoGoogle,
  IoLogoAmazon,
  IoLogoMicrosoft,
} from "react-icons/io5";

// Ant Design Icons (Ai)
import { 
  AiOutlineLoading3Quarters,
  AiOutlineStar,
  AiFillStar,
  AiOutlineHeart,
  AiFillHeart,
  AiOutlineCheck,
  AiOutlineClose,
  AiOutlinePlus,
  AiOutlineMinus,
  AiOutlineSearch,
  AiOutlineHome,
  AiOutlineSetting,
  AiOutlineUser,
  AiOutlineTeam,
  AiOutlineMail,
  AiOutlineBell,
  AiOutlineCalendar,
  AiOutlineClockCircle,
  AiOutlineEdit,
  AiOutlineDelete,
  AiOutlineSave,
  AiOutlineDownload,
  AiOutlineUpload,
  AiOutlineFolder,
  AiOutlineFolderOpen,
  AiOutlineFile,
  AiOutlineFileText,
  AiOutlineCode,
  AiOutlineApi,
  AiOutlineDatabase,
  AiOutlineCloud,
  AiOutlineCloudUpload,
  AiOutlineCloudDownload,
  AiOutlineLock,
  AiOutlineUnlock,
  AiOutlineKey,
  AiOutlineLink,
  AiOutlineGlobal,
  AiOutlineRocket,
  AiOutlineThunderbolt,
  AiOutlineFire,
  AiOutlineExperiment,
  AiOutlineBulb,
  AiOutlineWarning,
  AiOutlineInfoCircle,
  AiOutlineQuestionCircle,
  AiOutlineCheckCircle,
  AiOutlineCloseCircle,
  AiOutlineExclamationCircle,
  AiOutlineLike,
  AiOutlineDislike,
  AiOutlineTrophy,
  AiOutlineCrown,
  AiOutlineGift,
  AiOutlineShop,
  AiOutlineShoppingCart,
  AiOutlineDollar,
  AiOutlineCreditCard,
  AiOutlineBarChart,
  AiOutlineLineChart,
  AiOutlinePieChart,
  AiOutlineStock,
  AiOutlineRise,
  AiOutlineFall,
  AiOutlineEye,
  AiOutlineEyeInvisible,
  AiOutlineCopy,
  AiOutlineScissor,
  AiOutlineHighlight,
  AiOutlineBook,
  AiOutlineRead,
  AiOutlineFlag,
  AiOutlineTag,
  AiOutlineTags,
  AiOutlineFilter,
  AiOutlineOrderedList,
  AiOutlineUnorderedList,
  AiOutlineTable,
  AiOutlineLayout,
  AiOutlineAppstore,
  AiOutlineMenu,
  AiOutlineMore,
  AiOutlineShareAlt,
  AiOutlineExport,
  AiOutlineImport,
  AiOutlinePrinter,
  AiOutlineCamera,
  AiOutlinePicture,
  AiOutlineVideoCamera,
  AiOutlineSound,
  AiOutlinePlayCircle,
  AiOutlinePauseCircle,
  AiOutlineMessage,
  AiOutlineComment,
  AiOutlineSend,
  AiOutlineGithub,
  AiOutlineTwitter,
  AiOutlineLinkedin,
  AiOutlineSlack,
  AiOutlineYoutube,
  AiOutlineInstagram,
  AiOutlineFacebook,
  AiOutlineChrome,
  AiOutlineHtml5,
  AiOutlineAntDesign,
  AiOutlineSketch,
  AiOutlineRobot,
  AiOutlineSmile,
  AiOutlineMeh,
  AiOutlineFrown,
  AiOutlineBug,
  AiOutlineTool,
  AiOutlineApartment,
  AiOutlineBranches,
  AiOutlinePullRequest,
  AiOutlineMerge,
  AiOutlineNodeIndex,
  AiOutlineFunction,
  AiOutlineConsoleSql,
  AiOutlineCluster,
  AiOutlineBlock,
  AiOutlinePartition,
  AiOutlineAim,
  AiOutlineCompass,
  AiOutlineEnvironment,
  AiOutlineCar,
} from "react-icons/ai";

// Font Awesome Icons (Fa)
import { 
  FaRocket,
  FaStar,
  FaRegStar,
  FaHeart,
  FaRegHeart,
  FaCheck,
  FaTimes,
  FaPlus,
  FaMinus,
  FaSearch,
  FaHome,
  FaCog,
  FaCogs,
  FaUser,
  FaUsers,
  FaUserPlus,
  FaUserCheck,
  FaEnvelope,
  FaRegEnvelope,
  FaBell,
  FaRegBell,
  FaCalendar,
  FaRegCalendar,
  FaClock,
  FaRegClock,
  FaEdit,
  FaTrash,
  FaTrashAlt,
  FaSave,
  FaRegSave,
  FaDownload,
  FaUpload,
  FaFolder,
  FaRegFolder,
  FaFolderOpen,
  FaRegFolderOpen,
  FaFile,
  FaRegFile,
  FaFileAlt,
  FaRegFileAlt,
  FaCode,
  FaDatabase,
  FaCloud,
  FaCloudUploadAlt,
  FaCloudDownloadAlt,
  FaLock,
  FaLockOpen,
  FaKey,
  FaLink,
  FaGlobe,
  FaBolt,
  FaFire,
  FaLightbulb,
  FaRegLightbulb,
  FaExclamationTriangle,
  FaInfoCircle,
  FaQuestionCircle,
  FaCheckCircle,
  FaRegCheckCircle,
  FaTimesCircle,
  FaRegTimesCircle,
  FaExclamationCircle,
  FaThumbsUp,
  FaRegThumbsUp,
  FaThumbsDown,
  FaRegThumbsDown,
  FaTrophy,
  FaCrown,
  FaGift,
  FaStore,
  FaShoppingCart,
  FaDollarSign,
  FaCreditCard,
  FaChartBar,
  FaChartLine,
  FaChartPie,
  FaArrowUp,
  FaArrowDown,
  FaArrowLeft,
  FaArrowRight,
  FaEye,
  FaRegEye,
  FaEyeSlash,
  FaRegEyeSlash,
  FaCopy,
  FaRegCopy,
  FaCut,
  FaHighlighter,
  FaBook,
  FaRegBookmark,
  FaBookmark,
  FaFlag,
  FaRegFlag,
  FaTag,
  FaTags,
  FaFilter,
  FaSort,
  FaSortUp,
  FaSortDown,
  FaList,
  FaListUl,
  FaListOl,
  FaTable,
  FaTh,
  FaThLarge,
  FaBars,
  FaEllipsisH,
  FaEllipsisV,
  FaShare,
  FaShareAlt,
  FaExternalLinkAlt,
  FaPrint,
  FaCamera,
  FaImage,
  FaRegImage,
  FaVideo,
  FaVolumeUp,
  FaPlay,
  FaPause,
  FaStop,
  FaComment,
  FaRegComment,
  FaComments,
  FaRegComments,
  FaPaperPlane,
  FaRegPaperPlane,
  FaGithub,
  FaTwitter,
  FaLinkedin,
  FaLinkedinIn,
  FaSlack,
  FaDiscord,
  FaYoutube,
  FaInstagram,
  FaFacebook,
  FaChrome,
  FaHtml5,
  FaCss3Alt,
  FaJs,
  FaReact,
  FaNode,
  FaPython,
  FaJava,
  FaAws,
  FaDocker,
  FaGitAlt,
  FaTerminal,
  FaSmile,
  FaRegSmile,
  FaMeh,
  FaRegMeh,
  FaFrown,
  FaRegFrown,
  FaBug,
  FaTools,
  FaWrench,
  FaHammer,
  FaScrewdriver,
  FaPuzzlePiece,
  FaMagic,
  FaGem,
  FaMedal,
  FaAward,
  FaCertificate,
  FaShieldAlt,
  FaFingerprint,
  FaIdCard,
  FaIdBadge,
  FaBriefcase,
  FaBuilding,
  FaIndustry,
  FaMapMarkerAlt,
  FaMap,
  FaCompass,
  FaPlane,
  FaCar,
  FaTrain,
  FaBicycle,
  FaWalking,
  FaRunning,
  FaDumbbell,
  FaHeartbeat,
  FaStethoscope,
  FaAppleAlt,
  FaSeedling,
  FaLeaf,
  FaTree,
  FaWater,
  FaSun,
  FaMoon,
  FaCloudSun,
  FaSnowflake,
  FaGraduationCap,
  FaUniversity,
  FaUtensils,
  FaCoffee,
  FaBeer,
  FaWineGlass,
  FaPizzaSlice,
  FaHamburger,
  FaGamepad,
  FaDice,
  FaChess,
  FaPalette,
  FaPaintBrush,
  FaPen,
  FaPencilAlt,
  FaMousePointer,
  FaKeyboard,
  FaDesktop,
  FaLaptop,
  FaMobile,
  FaTablet,
  FaServer,
  FaMicrochip,
  FaMemory,
  FaHdd,
  FaSdCard,
  FaUsb,
  FaWifi,
  FaBluetooth,
  FaSignal,
  FaBatteryFull,
  FaBatteryHalf,
  FaBatteryEmpty,
  FaPlug,
  FaPowerOff,
  FaSyncAlt,
  FaSpinner,
  FaCircleNotch,
  FaCog as FaGear,
  FaExpandAlt,
  FaCompressAlt,
  FaSearchPlus,
  FaSearchMinus,
  FaUndo,
  FaRedo,
  FaHistory,
  FaArchive,
  FaBoxOpen,
  FaClipboard,
  FaClipboardCheck,
  FaClipboardList,
  FaPaste,
  FaPaperclip,
  FaThumbtack,
  FaStamp,
  FaSignature,
  FaFileContract,
  FaHandshake,
  FaBalanceScale,
  FaGavel,
  FaLandmark,
  FaVoteYea,
  FaBullhorn,
  FaNewspaper,
  FaRegNewspaper,
  FaRss,
  FaPodcast,
  FaBroadcastTower,
  FaSatellite,
  FaSatelliteDish,
  FaAnchor,
  FaLifeRing,
  FaUmbrella,
  FaUmbrellaBeach,
  FaMountain,
  FaSkiing,
  FaSwimmer,
  FaHiking,
  FaCampground,
  FaCaravan,
  FaRoad,
  FaRoute,
  FaDirections,
  FaStreetView,
  FaGlobeAmericas,
  FaGlobeEurope,
  FaGlobeAsia,
  FaGlobeAfrica,
  FaSpaceShuttle,
  FaMeteor,
  FaUserAstronaut,
  FaRobot,
  FaAndroid,
  FaApple,
  FaWindows,
  FaLinux,
  FaUbuntu,
  FaWordpress,
  FaShopify,
  FaStripe,
  FaPaypal,
  FaBitcoin,
  FaEthereum,
} from "react-icons/fa";

// Material Design Icons (Md)
import { 
  MdSettings,
  MdHome,
  MdSearch,
  MdPerson,
  MdGroup,
  MdMail,
  MdNotifications,
  MdCalendarToday,
  MdAccessTime,
  MdEdit,
  MdDelete,
  MdSave,
  MdDownload,
  MdUpload,
  MdFolder,
  MdFolderOpen,
  MdInsertDriveFile,
  MdDescription,
  MdCode,
  MdStorage,
  MdCloud,
  MdCloudUpload,
  MdCloudDownload,
  MdLock,
  MdLockOpen,
  MdVpnKey,
  MdLink,
  MdLanguage,
  MdFlashOn,
  MdLocalFireDepartment,
  MdLightbulb,
  MdWarning,
  MdInfo,
  MdHelp,
  MdCheckCircle,
  MdCancel,
  MdError,
  MdThumbUp,
  MdThumbDown,
  MdEmojiEvents,
  MdCardGiftcard,
  MdStore,
  MdShoppingCart,
  MdAttachMoney,
  MdCreditCard,
  MdBarChart,
  MdShowChart,
  MdPieChart,
  MdTrendingUp,
  MdTrendingDown,
  MdVisibility,
  MdVisibilityOff,
  MdContentCopy,
  MdContentCut,
  MdMenuBook,
  MdBookmark,
  MdBookmarkBorder,
  MdFlag,
  MdLabel,
  MdFilterList,
  MdSort,
  MdFormatListBulleted,
  MdFormatListNumbered,
  MdTableChart,
  MdGridView,
  MdMenu,
  MdMoreHoriz,
  MdMoreVert,
  MdShare,
  MdOpenInNew,
  MdPrint,
  MdCameraAlt,
  MdImage,
  MdVideocam,
  MdVolumeUp,
  MdPlayArrow,
  MdPause,
  MdStop,
  MdChat,
  MdComment,
  MdSend,
  MdSmartToy,
  MdSentimentSatisfied,
  MdSentimentNeutral,
  MdSentimentDissatisfied,
  MdBugReport,
  MdBuild,
  MdHandyman,
  MdExtension,
  MdAutoAwesome,
  MdDiamond,
  MdMilitaryTech,
  MdVerified,
  MdSecurity,
  MdFingerprint,
  MdBadge,
  MdWork,
  MdBusiness,
  MdLocationOn,
  MdMap,
  MdExplore,
  MdFlight,
  MdDirectionsCar,
  MdDirectionsBike,
  MdDirectionsWalk,
  MdDirectionsRun,
  MdFitnessCenter,
  MdFavorite,
  MdLocalHospital,
  MdEco,
  MdWaterDrop,
  MdWbSunny,
  MdNightsStay,
  MdSchool,
  MdRestaurant,
  MdLocalCafe,
  MdSportsBar,
  MdLocalPizza,
  MdFastfood,
  MdSportsEsports,
  MdCasino,
  MdPalette,
  MdBrush,
  MdCreate,
  MdDevices,
  MdComputer,
  MdPhoneIphone,
  MdTablet,
  MdDns,
  MdMemory,
  MdWifi,
  MdBluetooth,
  MdSignalCellularAlt,
  MdBattery90,
  MdBattery50,
  MdBattery20,
  MdPower,
  MdPowerOff,
  MdRefresh,
  MdSync,
  MdFullscreen,
  MdFullscreenExit,
  MdZoomIn,
  MdZoomOut,
  MdUndo,
  MdRedo,
  MdHistory,
  MdArchive,
  MdInventory,
  MdAssignment,
  MdAttachFile,
  MdPushPin,
  MdRocketLaunch,
  MdScience,
  MdPsychology,
  MdLightMode,
  MdDarkMode,
  MdStars,
  MdGrade,
  MdNewReleases,
  MdOutlinedFlag,
  MdPlaylistAdd,
  MdPlaylistAddCheck,
  MdAddTask,
  MdTask,
  MdTaskAlt,
  MdChecklist,
  MdRule,
  MdDataObject,
  MdTerminal,
  MdIntegrationInstructions,
  MdApi,
  MdHub,
  MdAccountTree,
} from "react-icons/md";

// BoxIcons (Bi)
import { 
  BiCodeAlt,
  BiCode,
  BiCodeBlock,
  BiCodeCurly,
  BiTerminal,
  BiGitBranch,
  BiGitCommit,
  BiGitMerge,
  BiGitPullRequest,
  BiData,
  BiServer,
  BiCloud,
  BiCloudUpload,
  BiCloudDownload,
  BiLock,
  BiLockOpen,
  BiKey,
  BiLink,
  BiLinkAlt,
  BiLinkExternal,
  BiGlobe,
  BiRocket,
  BiStar,
  BiHeart,
  BiCheck,
  BiX,
  BiPlus,
  BiMinus,
  BiSearch,
  BiHome,
  BiCog,
  BiUser,
  BiGroup,
  BiEnvelope,
  BiBell,
  BiCalendar,
  BiTime,
  BiEdit,
  BiTrash,
  BiSave,
  BiDownload,
  BiUpload,
  BiFolder,
  BiFolderOpen,
  BiFile,
  BiFileBlank,
  BiBookOpen,
  BiBookmark,
  BiFlag,
  BiLabel,
  BiFilter,
  BiSort,
  BiListUl,
  BiListOl,
  BiTable,
  BiGridAlt,
  BiMenu,
  BiDotsHorizontal,
  BiDotsVertical,
  BiShare,
  BiShareAlt,
  BiExport,
  BiImport,
  BiPrinter,
  BiCamera,
  BiImage,
  BiVideo,
  BiVolumeFull,
  BiPlay,
  BiPause,
  BiStop,
  BiComment,
  BiCommentDetail,
  BiMessageDetail,
  BiMessageSquareDetail,
  BiSend,
  BiLogoGithub,
  BiLogoTwitter,
  BiLogoLinkedin,
  BiLogoSlack,
  BiLogoDiscord,
  BiLogoYoutube,
  BiLogoInstagram,
  BiLogoFacebook,
  BiLogoPython,
  BiLogoJavascript,
  BiLogoTypescript,
  BiLogoReact,
  BiLogoNodejs,
  BiLogoHtml5,
  BiLogoCss3,
  BiSmile,
  BiMeh,
  BiSad,
  BiBug,
  BiWrench,
  BiCut,
  BiCopy,
  BiPaste,
  BiClipboard,
  BiPalette,
  BiPaint,
  BiPencil,
  BiEraser,
  BiRuler,
  BiCompass,
  BiMap,
  BiMapPin,
  BiWorld,
  BiCar,
  BiBus,
  BiTrain,
  BiRun,
  BiWalk,
  BiCycling,
  BiDumbbell,
  BiHeart as BiHeartFilled,
  BiLeaf,
  BiDroplet,
  BiSun,
  BiMoon,
  BiCloud as BiCloudFilled,
  BiWind,
  BiBriefcase,
  BiBuildings,
  BiStore,
  BiRestaurant,
  BiCoffee,
  BiDrink,
  BiGame,
  BiDice1,
  BiAtom,
  BiDna,
  BiFirstAid,
  BiPulse,
  BiInjection,
  BiCapsule,
  BiPlusMedical,
  BiTestTube,
  BiTargetLock,
  BiAnalyse,
  BiBarChartAlt,
  BiLineChart,
  BiPieChartAlt,
  BiTrendingUp,
  BiTrendingDown,
  BiDollar,
  BiCreditCard,
  BiWallet,
  BiCart,
  BiReceipt,
  BiPurchaseTag,
  BiGift,
  BiTrophy,
  BiMedal,
  BiAward,
  BiCrown,
  BiShieldAlt,
  BiFingerprint,
  BiIdCard,
  BiError,
  BiErrorCircle,
  BiInfoCircle,
  BiHelpCircle,
  BiCheckCircle,
  BiXCircle,
  BiErrorAlt,
  BiLike,
  BiDislike,
  BiHappy,
  BiConfused,
  BiAngry,
  BiCool,
  BiGhost,
  BiAlarm,
  BiHistory,
  BiArchive,
  BiBox,
  BiPackage,
  BiTask,
  BiTaskX,
  BiNote,
  BiNotepad,
  BiNews,
  BiExpand,
  BiCollapse,
  BiFullscreen,
  BiExitFullscreen,
  BiZoomIn,
  BiZoomOut,
  BiRefresh,
  BiSync,
  BiLoaderAlt,
  BiPowerOff,
  BiDesktop,
  BiLaptop,
  BiMobile,
  BiChip,
  BiUsb,
  BiWifi,
  BiBluetooth,
  BiSignal5,
  BiSignal4,
  BiSignal3,
  BiSignal2,
  BiSignal1,
  BiBattery,
  BiPlug,
} from "react-icons/bi";

// Tool UI components - beautiful neumorphic views
import { KnowledgeToolView } from "@/components/tools/knowledge-tool-view";
import { KnowledgeLinkToolView } from "@/components/tools/knowledge-link-tool-view";
import { WebSearchView } from "@/components/tools/web-search-view";
import { ChatSearchView } from "@/components/tools/chat-search-view";
import { DocumentSearchView, DocumentListView } from "@/components/tools/document-search-view";
import { GenericToolView } from "@/components/tools/generic-tool-view";
import { ContextSaverView, type ParallelTask } from "@/components/tools/context-saver-view";
import { AgentOrchestratorView, MAX_AGENTS, type OrchestratorState, type AgentTask, type AgentStatus } from "@/components/tools/agent-orchestrator-view";
import { PdfExportView } from "@/components/tools/pdf-export-view";

// =============================================================================
// INLINE ICON SUPPORT FOR MARKDOWN
// =============================================================================

/**
 * Inline icon support using a curated allowlist to avoid bundling
 * entire icon packs.
 *
 * Syntax: :IconName: (e.g., :IoHeart: :FaRocket: :MdSettings:)
 *
 * To add more icons:
 * 1) Import the icon explicitly
 * 2) Add it to INLINE_ICONS below
 */

const INLINE_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  // Ionicons (Io5) - Primary icon set
  IoArrowUp,
  IoArrowDown,
  IoArrowForward,
  IoArrowBack,
  IoGlobeOutline,
  IoClose,
  IoDocumentText,
  IoChevronDown,
  IoChevronUp,
  IoChevronForward,
  IoChevronBack,
  IoCheckmark,
  IoCheckmarkCircle,
  IoAlertCircle,
  IoPencil,
  IoRefresh,
  IoExpand,
  IoContract,
  IoCopy,
  IoCheckmarkDone,
  IoTerminal,
  IoOpenOutline,
  IoReload,
  IoHeart,
  IoHeartOutline,
  IoStar,
  IoStarOutline,
  IoHome,
  IoHomeOutline,
  IoSettings,
  IoSettingsOutline,
  IoSearch,
  IoSearchOutline,
  IoAdd,
  IoRemove,
  IoTrash,
  IoTrashOutline,
  IoCreate,
  IoCreateOutline,
  IoSave,
  IoSaveOutline,
  IoDownload,
  IoDownloadOutline,
  IoCloudUpload,
  IoCloudUploadOutline,
  IoFolder,
  IoFolderOutline,
  IoFolderOpen,
  IoFolderOpenOutline,
  IoDocument,
  IoDocumentOutline,
  IoMail,
  IoMailOutline,
  IoSend,
  IoSendOutline,
  IoNotifications,
  IoNotificationsOutline,
  IoWarning,
  IoWarningOutline,
  IoInformationCircle,
  IoInformationCircleOutline,
  IoHelpCircle,
  IoHelpCircleOutline,
  IoTime,
  IoTimeOutline,
  IoCalendar,
  IoCalendarOutline,
  IoLocation,
  IoLocationOutline,
  IoPerson,
  IoPersonOutline,
  IoPeople,
  IoPeopleOutline,
  IoLockClosed,
  IoLockClosedOutline,
  IoLockOpen,
  IoLockOpenOutline,
  IoKey,
  IoKeyOutline,
  IoLink,
  IoLinkOutline,
  IoCode,
  IoCodeOutline,
  IoGitBranch,
  IoGitBranchOutline,
  IoPlayCircle,
  IoPlayCircleOutline,
  IoPause,
  IoPauseCircle,
  IoStop,
  IoStopCircle,
  IoMusicalNotes,
  IoCamera,
  IoCameraOutline,
  IoImage,
  IoImageOutline,
  IoVideocam,
  IoVideocamOutline,
  IoMic,
  IoMicOutline,
  IoVolumeHigh,
  IoVolumeMedium,
  IoVolumeLow,
  IoVolumeMute,
  IoBulb,
  IoBulbOutline,
  IoFlash,
  IoFlashOutline,
  IoThumbsUp,
  IoThumbsUpOutline,
  IoThumbsDown,
  IoThumbsDownOutline,
  IoTrophy,
  IoTrophyOutline,
  IoRibbon,
  IoRibbonOutline,
  IoFlag,
  IoFlagOutline,
  IoBookmark,
  IoBookmarkOutline,
  IoBook,
  IoBookOutline,
  IoNewspaper,
  IoNewspaperOutline,
  IoList,
  IoListOutline,
  IoGrid,
  IoGridOutline,
  IoMenu,
  IoMenuOutline,
  IoEllipsisHorizontal,
  IoEllipsisVertical,
  IoShare,
  IoShareOutline,
  IoEye,
  IoEyeOutline,
  IoEyeOff,
  IoEyeOffOutline,
  IoFingerPrint,
  IoShield,
  IoShieldCheckmark,
  IoSparkles,
  IoColorPalette,
  IoColorPaletteOutline,
  IoBrush,
  IoBrushOutline,
  IoConstruct,
  IoConstructOutline,
  IoHammer,
  IoHammerOutline,
  IoBuild,
  IoBuildOutline,
  IoAnalytics,
  IoAnalyticsOutline,
  IoBarChart,
  IoBarChartOutline,
  IoPieChart,
  IoPieChartOutline,
  IoTrendingUp,
  IoTrendingDown,
  IoCart,
  IoCartOutline,
  IoPricetag,
  IoPricetagOutline,
  IoWallet,
  IoWalletOutline,
  IoCard,
  IoCardOutline,
  IoCash,
  IoCashOutline,
  IoGift,
  IoGiftOutline,
  IoPlanet,
  IoPlanetOutline,
  IoRocket,
  IoRocketOutline,
  IoAirplane,
  IoAirplaneOutline,
  IoCar,
  IoCarOutline,
  IoBicycle,
  IoWalk,
  IoFitness,
  IoFitnessOutline,
  IoMedical,
  IoMedicalOutline,
  IoPulse,
  IoNutrition,
  IoLeaf,
  IoLeafOutline,
  IoWater,
  IoWaterOutline,
  IoSunny,
  IoSunnyOutline,
  IoMoon,
  IoMoonOutline,
  IoCloud,
  IoCloudOutline,
  IoRainy,
  IoRainyOutline,
  IoSnow,
  IoSnowOutline,
  IoThunderstorm,
  IoSchool,
  IoSchoolOutline,
  IoBriefcase,
  IoBriefcaseOutline,
  IoStorefront,
  IoStorefrontOutline,
  IoRestaurant,
  IoRestaurantOutline,
  IoCafe,
  IoCafeOutline,
  IoBeer,
  IoBeerOutline,
  IoWine,
  IoWineOutline,
  IoPizza,
  IoFastFood,
  IoGameController,
  IoGameControllerOutline,
  IoDice,
  IoDiceOutline,
  IoExtensionPuzzle,
  IoExtensionPuzzleOutline,
  IoAccessibility,
  IoAccessibilityOutline,
  IoHappy,
  IoHappyOutline,
  IoSad,
  IoSadOutline,
  IoSkull,
  IoSkullOutline,
  IoPaw,
  IoPawOutline,
  IoBug,
  IoBugOutline,
  IoLogoGithub,
  IoLogoTwitter,
  IoLogoLinkedin,
  IoLogoDiscord,
  IoLogoSlack,
  IoLogoPython,
  IoLogoJavascript,
  IoLogoReact,
  IoLogoNodejs,
  IoLogoApple,
  IoLogoGoogle,
  IoLogoAmazon,
  IoLogoMicrosoft,

  // Ant Design Icons (Ai)
  AiOutlineLoading3Quarters,
  AiOutlineStar,
  AiFillStar,
  AiOutlineHeart,
  AiFillHeart,
  AiOutlineCheck,
  AiOutlineClose,
  AiOutlinePlus,
  AiOutlineMinus,
  AiOutlineSearch,
  AiOutlineHome,
  AiOutlineSetting,
  AiOutlineUser,
  AiOutlineTeam,
  AiOutlineMail,
  AiOutlineBell,
  AiOutlineCalendar,
  AiOutlineClockCircle,
  AiOutlineEdit,
  AiOutlineDelete,
  AiOutlineSave,
  AiOutlineDownload,
  AiOutlineUpload,
  AiOutlineFolder,
  AiOutlineFolderOpen,
  AiOutlineFile,
  AiOutlineFileText,
  AiOutlineCode,
  AiOutlineApi,
  AiOutlineDatabase,
  AiOutlineCloud,
  AiOutlineCloudUpload,
  AiOutlineCloudDownload,
  AiOutlineLock,
  AiOutlineUnlock,
  AiOutlineKey,
  AiOutlineLink,
  AiOutlineGlobal,
  AiOutlineRocket,
  AiOutlineThunderbolt,
  AiOutlineFire,
  AiOutlineExperiment,
  AiOutlineBulb,
  AiOutlineWarning,
  AiOutlineInfoCircle,
  AiOutlineQuestionCircle,
  AiOutlineCheckCircle,
  AiOutlineCloseCircle,
  AiOutlineExclamationCircle,
  AiOutlineLike,
  AiOutlineDislike,
  AiOutlineTrophy,
  AiOutlineCrown,
  AiOutlineGift,
  AiOutlineShop,
  AiOutlineShoppingCart,
  AiOutlineDollar,
  AiOutlineCreditCard,
  AiOutlineBarChart,
  AiOutlineLineChart,
  AiOutlinePieChart,
  AiOutlineStock,
  AiOutlineRise,
  AiOutlineFall,
  AiOutlineEye,
  AiOutlineEyeInvisible,
  AiOutlineCopy,
  AiOutlineScissor,
  AiOutlineHighlight,
  AiOutlineBook,
  AiOutlineRead,
  AiOutlineFlag,
  AiOutlineTag,
  AiOutlineTags,
  AiOutlineFilter,
  AiOutlineOrderedList,
  AiOutlineUnorderedList,
  AiOutlineTable,
  AiOutlineLayout,
  AiOutlineAppstore,
  AiOutlineMenu,
  AiOutlineMore,
  AiOutlineShareAlt,
  AiOutlineExport,
  AiOutlineImport,
  AiOutlinePrinter,
  AiOutlineCamera,
  AiOutlinePicture,
  AiOutlineVideoCamera,
  AiOutlineSound,
  AiOutlinePlayCircle,
  AiOutlinePauseCircle,
  AiOutlineMessage,
  AiOutlineComment,
  AiOutlineSend,
  AiOutlineGithub,
  AiOutlineTwitter,
  AiOutlineLinkedin,
  AiOutlineSlack,
  AiOutlineYoutube,
  AiOutlineInstagram,
  AiOutlineFacebook,
  AiOutlineChrome,
  AiOutlineHtml5,
  AiOutlineAntDesign,
  AiOutlineSketch,
  AiOutlineRobot,
  AiOutlineSmile,
  AiOutlineMeh,
  AiOutlineFrown,
  AiOutlineBug,
  AiOutlineTool,
  AiOutlineApartment,
  AiOutlineBranches,
  AiOutlinePullRequest,
  AiOutlineMerge,
  AiOutlineNodeIndex,
  AiOutlineFunction,
  AiOutlineConsoleSql,
  AiOutlineCluster,
  AiOutlineBlock,
  AiOutlinePartition,
  AiOutlineAim,
  AiOutlineCompass,
  AiOutlineEnvironment,
  AiOutlineCar,

  // Font Awesome Icons (Fa)
  FaRocket,
  FaStar,
  FaRegStar,
  FaHeart,
  FaRegHeart,
  FaCheck,
  FaTimes,
  FaPlus,
  FaMinus,
  FaSearch,
  FaHome,
  FaCog,
  FaCogs,
  FaUser,
  FaUsers,
  FaUserPlus,
  FaUserCheck,
  FaEnvelope,
  FaRegEnvelope,
  FaBell,
  FaRegBell,
  FaCalendar,
  FaRegCalendar,
  FaClock,
  FaRegClock,
  FaEdit,
  FaTrash,
  FaTrashAlt,
  FaSave,
  FaRegSave,
  FaDownload,
  FaUpload,
  FaFolder,
  FaRegFolder,
  FaFolderOpen,
  FaRegFolderOpen,
  FaFile,
  FaRegFile,
  FaFileAlt,
  FaRegFileAlt,
  FaCode,
  FaDatabase,
  FaCloud,
  FaCloudUploadAlt,
  FaCloudDownloadAlt,
  FaLock,
  FaLockOpen,
  FaKey,
  FaLink,
  FaGlobe,
  FaBolt,
  FaFire,
  FaLightbulb,
  FaRegLightbulb,
  FaExclamationTriangle,
  FaInfoCircle,
  FaQuestionCircle,
  FaCheckCircle,
  FaRegCheckCircle,
  FaTimesCircle,
  FaRegTimesCircle,
  FaExclamationCircle,
  FaThumbsUp,
  FaRegThumbsUp,
  FaThumbsDown,
  FaRegThumbsDown,
  FaTrophy,
  FaCrown,
  FaGift,
  FaStore,
  FaShoppingCart,
  FaDollarSign,
  FaCreditCard,
  FaChartBar,
  FaChartLine,
  FaChartPie,
  FaArrowUp,
  FaArrowDown,
  FaArrowLeft,
  FaArrowRight,
  FaEye,
  FaRegEye,
  FaEyeSlash,
  FaRegEyeSlash,
  FaCopy,
  FaRegCopy,
  FaCut,
  FaHighlighter,
  FaBook,
  FaRegBookmark,
  FaBookmark,
  FaFlag,
  FaRegFlag,
  FaTag,
  FaTags,
  FaFilter,
  FaSort,
  FaSortUp,
  FaSortDown,
  FaList,
  FaListUl,
  FaListOl,
  FaTable,
  FaTh,
  FaThLarge,
  FaBars,
  FaEllipsisH,
  FaEllipsisV,
  FaShare,
  FaShareAlt,
  FaExternalLinkAlt,
  FaPrint,
  FaCamera,
  FaImage,
  FaRegImage,
  FaVideo,
  FaVolumeUp,
  FaPlay,
  FaPause,
  FaStop,
  FaComment,
  FaRegComment,
  FaComments,
  FaRegComments,
  FaPaperPlane,
  FaRegPaperPlane,
  FaGithub,
  FaTwitter,
  FaLinkedin,
  FaLinkedinIn,
  FaSlack,
  FaDiscord,
  FaYoutube,
  FaInstagram,
  FaFacebook,
  FaChrome,
  FaHtml5,
  FaCss3Alt,
  FaJs,
  FaReact,
  FaNode,
  FaPython,
  FaJava,
  FaAws,
  FaDocker,
  FaGitAlt,
  FaTerminal,
  FaSmile,
  FaRegSmile,
  FaMeh,
  FaRegMeh,
  FaFrown,
  FaRegFrown,
  FaBug,
  FaTools,
  FaWrench,
  FaHammer,
  FaScrewdriver,
  FaPuzzlePiece,
  FaMagic,
  FaGem,
  FaMedal,
  FaAward,
  FaCertificate,
  FaShieldAlt,
  FaFingerprint,
  FaIdCard,
  FaIdBadge,
  FaBriefcase,
  FaBuilding,
  FaIndustry,
  FaMapMarkerAlt,
  FaMap,
  FaCompass,
  FaPlane,
  FaCar,
  FaTrain,
  FaBicycle,
  FaWalking,
  FaRunning,
  FaDumbbell,
  FaHeartbeat,
  FaStethoscope,
  FaAppleAlt,
  FaSeedling,
  FaLeaf,
  FaTree,
  FaWater,
  FaSun,
  FaMoon,
  FaCloudSun,
  FaSnowflake,
  FaGraduationCap,
  FaUniversity,
  FaUtensils,
  FaCoffee,
  FaBeer,
  FaWineGlass,
  FaPizzaSlice,
  FaHamburger,
  FaGamepad,
  FaDice,
  FaChess,
  FaPalette,
  FaPaintBrush,
  FaPen,
  FaPencilAlt,
  FaMousePointer,
  FaKeyboard,
  FaDesktop,
  FaLaptop,
  FaMobile,
  FaTablet,
  FaServer,
  FaMicrochip,
  FaMemory,
  FaHdd,
  FaSdCard,
  FaUsb,
  FaWifi,
  FaBluetooth,
  FaSignal,
  FaBatteryFull,
  FaBatteryHalf,
  FaBatteryEmpty,
  FaPlug,
  FaPowerOff,
  FaSyncAlt,
  FaSpinner,
  FaCircleNotch,
  FaGear,
  FaExpandAlt,
  FaCompressAlt,
  FaSearchPlus,
  FaSearchMinus,
  FaUndo,
  FaRedo,
  FaHistory,
  FaArchive,
  FaBoxOpen,
  FaClipboard,
  FaClipboardCheck,
  FaClipboardList,
  FaPaste,
  FaPaperclip,
  FaThumbtack,
  FaStamp,
  FaSignature,
  FaFileContract,
  FaHandshake,
  FaBalanceScale,
  FaGavel,
  FaLandmark,
  FaVoteYea,
  FaBullhorn,
  FaNewspaper,
  FaRegNewspaper,
  FaRss,
  FaPodcast,
  FaBroadcastTower,
  FaSatellite,
  FaSatelliteDish,
  FaAnchor,
  FaLifeRing,
  FaUmbrella,
  FaUmbrellaBeach,
  FaMountain,
  FaSkiing,
  FaSwimmer,
  FaHiking,
  FaCampground,
  FaCaravan,
  FaRoad,
  FaRoute,
  FaDirections,
  FaStreetView,
  FaGlobeAmericas,
  FaGlobeEurope,
  FaGlobeAsia,
  FaGlobeAfrica,
  FaSpaceShuttle,
  FaMeteor,
  FaUserAstronaut,
  FaRobot,
  FaAndroid,
  FaApple,
  FaWindows,
  FaLinux,
  FaUbuntu,
  FaWordpress,
  FaShopify,
  FaStripe,
  FaPaypal,
  FaBitcoin,
  FaEthereum,

  // Material Design Icons (Md)
  MdSettings,
  MdHome,
  MdSearch,
  MdPerson,
  MdGroup,
  MdMail,
  MdNotifications,
  MdCalendarToday,
  MdAccessTime,
  MdEdit,
  MdDelete,
  MdSave,
  MdDownload,
  MdUpload,
  MdFolder,
  MdFolderOpen,
  MdInsertDriveFile,
  MdDescription,
  MdCode,
  MdStorage,
  MdCloud,
  MdCloudUpload,
  MdCloudDownload,
  MdLock,
  MdLockOpen,
  MdVpnKey,
  MdLink,
  MdLanguage,
  MdFlashOn,
  MdLocalFireDepartment,
  MdLightbulb,
  MdWarning,
  MdInfo,
  MdHelp,
  MdCheckCircle,
  MdCancel,
  MdError,
  MdThumbUp,
  MdThumbDown,
  MdEmojiEvents,
  MdCardGiftcard,
  MdStore,
  MdShoppingCart,
  MdAttachMoney,
  MdCreditCard,
  MdBarChart,
  MdShowChart,
  MdPieChart,
  MdTrendingUp,
  MdTrendingDown,
  MdVisibility,
  MdVisibilityOff,
  MdContentCopy,
  MdContentCut,
  MdMenuBook,
  MdBookmark,
  MdBookmarkBorder,
  MdFlag,
  MdLabel,
  MdFilterList,
  MdSort,
  MdFormatListBulleted,
  MdFormatListNumbered,
  MdTableChart,
  MdGridView,
  MdMenu,
  MdMoreHoriz,
  MdMoreVert,
  MdShare,
  MdOpenInNew,
  MdPrint,
  MdCameraAlt,
  MdImage,
  MdVideocam,
  MdVolumeUp,
  MdPlayArrow,
  MdPause,
  MdStop,
  MdChat,
  MdComment,
  MdSend,
  MdSmartToy,
  MdSentimentSatisfied,
  MdSentimentNeutral,
  MdSentimentDissatisfied,
  MdBugReport,
  MdBuild,
  MdHandyman,
  MdExtension,
  MdAutoAwesome,
  MdDiamond,
  MdMilitaryTech,
  MdVerified,
  MdSecurity,
  MdFingerprint,
  MdBadge,
  MdWork,
  MdBusiness,
  MdLocationOn,
  MdMap,
  MdExplore,
  MdFlight,
  MdDirectionsCar,
  MdDirectionsBike,
  MdDirectionsWalk,
  MdDirectionsRun,
  MdFitnessCenter,
  MdFavorite,
  MdLocalHospital,
  MdEco,
  MdWaterDrop,
  MdWbSunny,
  MdNightsStay,
  MdSchool,
  MdRestaurant,
  MdLocalCafe,
  MdSportsBar,
  MdLocalPizza,
  MdFastfood,
  MdSportsEsports,
  MdCasino,
  MdPalette,
  MdBrush,
  MdCreate,
  MdDevices,
  MdComputer,
  MdPhoneIphone,
  MdTablet,
  MdDns,
  MdMemory,
  MdWifi,
  MdBluetooth,
  MdSignalCellularAlt,
  MdBattery90,
  MdBattery50,
  MdBattery20,
  MdPower,
  MdPowerOff,
  MdRefresh,
  MdSync,
  MdFullscreen,
  MdFullscreenExit,
  MdZoomIn,
  MdZoomOut,
  MdUndo,
  MdRedo,
  MdHistory,
  MdArchive,
  MdInventory,
  MdAssignment,
  MdAttachFile,
  MdPushPin,
  MdRocketLaunch,
  MdScience,
  MdPsychology,
  MdLightMode,
  MdDarkMode,
  MdStars,
  MdGrade,
  MdNewReleases,
  MdOutlinedFlag,
  MdPlaylistAdd,
  MdPlaylistAddCheck,
  MdAddTask,
  MdTask,
  MdTaskAlt,
  MdChecklist,
  MdRule,
  MdDataObject,
  MdTerminal,
  MdIntegrationInstructions,
  MdApi,
  MdHub,
  MdAccountTree,

  // BoxIcons (Bi)
  BiCodeAlt,
  BiCode,
  BiCodeBlock,
  BiCodeCurly,
  BiTerminal,
  BiGitBranch,
  BiGitCommit,
  BiGitMerge,
  BiGitPullRequest,
  BiData,
  BiServer,
  BiCloud,
  BiCloudUpload,
  BiCloudDownload,
  BiLock,
  BiLockOpen,
  BiKey,
  BiLink,
  BiLinkAlt,
  BiLinkExternal,
  BiGlobe,
  BiRocket,
  BiStar,
  BiHeart,
  BiCheck,
  BiX,
  BiPlus,
  BiMinus,
  BiSearch,
  BiHome,
  BiCog,
  BiUser,
  BiGroup,
  BiEnvelope,
  BiBell,
  BiCalendar,
  BiTime,
  BiEdit,
  BiTrash,
  BiSave,
  BiDownload,
  BiUpload,
  BiFolder,
  BiFolderOpen,
  BiFile,
  BiFileBlank,
  BiBookOpen,
  BiBookmark,
  BiFlag,
  BiLabel,
  BiFilter,
  BiSort,
  BiListUl,
  BiListOl,
  BiTable,
  BiGridAlt,
  BiMenu,
  BiDotsHorizontal,
  BiDotsVertical,
  BiShare,
  BiShareAlt,
  BiExport,
  BiImport,
  BiPrinter,
  BiCamera,
  BiImage,
  BiVideo,
  BiVolumeFull,
  BiPlay,
  BiPause,
  BiStop,
  BiComment,
  BiCommentDetail,
  BiMessageDetail,
  BiMessageSquareDetail,
  BiSend,
  BiLogoGithub,
  BiLogoTwitter,
  BiLogoLinkedin,
  BiLogoSlack,
  BiLogoDiscord,
  BiLogoYoutube,
  BiLogoInstagram,
  BiLogoFacebook,
  BiLogoPython,
  BiLogoJavascript,
  BiLogoTypescript,
  BiLogoReact,
  BiLogoNodejs,
  BiLogoHtml5,
  BiLogoCss3,
  BiSmile,
  BiMeh,
  BiSad,
  BiBug,
  BiWrench,
  BiCut,
  BiCopy,
  BiPaste,
  BiClipboard,
  BiPalette,
  BiPaint,
  BiPencil,
  BiEraser,
  BiRuler,
  BiCompass,
  BiMap,
  BiMapPin,
  BiWorld,
  BiCar,
  BiBus,
  BiTrain,
  BiRun,
  BiWalk,
  BiCycling,
  BiDumbbell,
  BiHeartFilled,
  BiLeaf,
  BiDroplet,
  BiSun,
  BiMoon,
  BiCloudFilled,
  BiWind,
  BiBriefcase,
  BiBuildings,
  BiStore,
  BiRestaurant,
  BiCoffee,
  BiDrink,
  BiGame,
  BiDice1,
  BiAtom,
  BiDna,
  BiFirstAid,
  BiPulse,
  BiInjection,
  BiCapsule,
  BiPlusMedical,
  BiTestTube,
  BiTargetLock,
  BiAnalyse,
  BiBarChartAlt,
  BiLineChart,
  BiPieChartAlt,
  BiTrendingUp,
  BiTrendingDown,
  BiDollar,
  BiCreditCard,
  BiWallet,
  BiCart,
  BiReceipt,
  BiPurchaseTag,
  BiGift,
  BiTrophy,
  BiMedal,
  BiAward,
  BiCrown,
  BiShieldAlt,
  BiFingerprint,
  BiIdCard,
  BiError,
  BiErrorCircle,
  BiInfoCircle,
  BiHelpCircle,
  BiCheckCircle,
  BiXCircle,
  BiErrorAlt,
  BiLike,
  BiDislike,
  BiHappy,
  BiConfused,
  BiAngry,
  BiCool,
  BiGhost,
  BiAlarm,
  BiHistory,
  BiArchive,
  BiBox,
  BiPackage,
  BiTask,
  BiTaskX,
  BiNote,
  BiNotepad,
  BiNews,
  BiExpand,
  BiCollapse,
  BiFullscreen,
  BiExitFullscreen,
  BiZoomIn,
  BiZoomOut,
  BiRefresh,
  BiSync,
  BiLoaderAlt,
  BiPowerOff,
  BiDesktop,
  BiLaptop,
  BiMobile,
  BiChip,
  BiUsb,
  BiWifi,
  BiBluetooth,
  BiSignal5,
  BiSignal4,
  BiSignal3,
  BiSignal2,
  BiSignal1,
  BiBattery,
  BiPlug,
};

/**
 * Get an icon component by name (synchronous lookup)
 */
function getIconComponent(
  name: string
): React.ComponentType<{ className?: string }> | null {
  return INLINE_ICONS[name] || null;
}

// =============================================================================
// CODE BLOCK COMPONENT
// =============================================================================

interface CodeBlockProps {
  language?: string;
  children: string;
}

// Language display name mapping - defined outside component to avoid recreation
const LANGUAGE_NAMES: Record<string, string> = {
  js: "JavaScript",
  javascript: "JavaScript",
  ts: "TypeScript",
  typescript: "TypeScript",
  jsx: "JSX",
  tsx: "TSX",
  py: "Python",
  python: "Python",
  rb: "Ruby",
  ruby: "Ruby",
  go: "Go",
  rust: "Rust",
  rs: "Rust",
  java: "Java",
  kt: "Kotlin",
  kotlin: "Kotlin",
  swift: "Swift",
  c: "C",
  cpp: "C++",
  "c++": "C++",
  cs: "C#",
  csharp: "C#",
  php: "PHP",
  sql: "SQL",
  html: "HTML",
  css: "CSS",
  scss: "SCSS",
  sass: "Sass",
  less: "Less",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  xml: "XML",
  md: "Markdown",
  markdown: "Markdown",
  sh: "Shell",
  bash: "Bash",
  zsh: "Zsh",
  fish: "Fish",
  powershell: "PowerShell",
  ps1: "PowerShell",
  dockerfile: "Dockerfile",
  docker: "Docker",
  graphql: "GraphQL",
  gql: "GraphQL",
  prisma: "Prisma",
  toml: "TOML",
  ini: "INI",
  env: "ENV",
  txt: "Text",
  text: "Text",
  plaintext: "Text",
  diff: "Diff",
  gitignore: "Git Ignore",
  mathblock: "Math",  // Used for ```math code blocks (preprocessed to avoid remark-math)
};

// Map common language aliases to Prism language names - defined outside component
const PRISM_LANGUAGE_MAP: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  kt: "kotlin",
  cs: "csharp",
  "c++": "cpp",
  yml: "yaml",
  sh: "bash",
  zsh: "bash",
  fish: "bash",
  ps1: "powershell",
  dockerfile: "docker",
  gql: "graphql",
  md: "markdown",
  txt: "text",
  text: "text",
  plaintext: "text",
  mathblock: "text",  // Render math code blocks as plain text (no special syntax highlighting)
};

// Custom gruvbox style - defined outside component to avoid recreation
const CUSTOM_GRUVBOX_STYLE = {
  ...gruvboxDark,
  'pre[class*="language-"]': {
    ...gruvboxDark['pre[class*="language-"]'],
    background: "#1d2021",
    margin: 0,
    padding: "1rem",
    fontSize: "0.875rem",
    lineHeight: "1.6",
  },
  'code[class*="language-"]': {
    ...gruvboxDark['code[class*="language-"]'],
    background: "transparent",
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
  },
};

// Static style objects for SyntaxHighlighter - defined outside to prevent recreation
const CODE_BLOCK_CUSTOM_STYLE = { margin: 0, background: "#1d2021" };
const CODE_TAG_PROPS = {
  style: {
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
  }
};

const CodeBlock = React.memo(function CodeBlock({ language, children }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [children]);

  const displayLanguage = language ? (LANGUAGE_NAMES[language.toLowerCase()] || language) : "Code";
  const prismLanguage = language ? (PRISM_LANGUAGE_MAP[language.toLowerCase()] || language.toLowerCase()) : "text";

  return (
    <div className="group/code relative my-4 rounded-xl overflow-hidden border border-gray-700 dark:border-neutral-600">
      {/* Header - gruvbox dark background */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#282828] border-b border-[#3c3836]">
        <div className="flex items-center gap-2">
          <IoTerminal className="w-4 h-4 text-[#a89984]" />
          <span className="text-xs font-medium text-[#a89984]">{displayLanguage}</span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2 py-1 text-xs text-[#a89984] hover:text-[#ebdbb2] hover:bg-[#3c3836] rounded transition-colors"
          title="Copy code"
        >
          {copied ? (
            <>
              <IoCheckmarkDone className="w-3.5 h-3.5 text-[#b8bb26]" />
              <span className="text-[#b8bb26]">Copied!</span>
            </>
          ) : (
            <>
              <IoCopy className="w-3.5 h-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      {/* Code content with syntax highlighting */}
      <div className="overflow-x-auto bg-[#1d2021]">
        <SyntaxHighlighter
          language={prismLanguage}
          style={CUSTOM_GRUVBOX_STYLE}
          customStyle={CODE_BLOCK_CUSTOM_STYLE}
          codeTagProps={CODE_TAG_PROPS}
        >
          {children}
        </SyntaxHighlighter>
      </div>
    </div>
  );
});

// =============================================================================
// INLINE CODE COMPONENT
// =============================================================================

const InlineCode = React.memo(function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="px-1.5 py-0.5 text-sm font-mono bg-gray-100 dark:bg-neutral-800 text-pink-600 dark:text-pink-400 rounded-md border border-gray-200 dark:border-neutral-700">
      {children}
    </code>
  );
});

// =============================================================================
// CUSTOM MARKDOWN COMPONENTS
// =============================================================================

/**
 * Process text to replace :IconName: with allowed icons.
 *
 * Usage: :IoHeart: :FaRocket: :MdSettings: :BiCodeAlt: :AiOutlineStar:
 *
 * If an icon is not found, it renders a fallback icon instead.
 */
function processTextWithIcons(text: string): React.ReactNode[] {
  // Match icon names: :IconName: where IconName starts with capital letter
  const iconPattern = /:([A-Z][a-zA-Z0-9]*):/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = iconPattern.exec(text)) !== null) {
    // Add text before the icon
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    
    const iconName = match[1];
    const IconComponent = getIconComponent(iconName);
    
    if (IconComponent) {
      parts.push(
        <IconComponent 
          key={`icon-${match.index}`} 
          className="inline-block w-4 h-4 mx-0.5 align-text-bottom" 
        />
      );
    } else {
      // Fallback: render a neutral placeholder icon (puzzle piece) for unknown icons
      // This is more professional than using emojis
      parts.push(
        <IoExtensionPuzzle 
          key={`icon-fallback-${match.index}`}
          className="inline-block w-4 h-4 mx-0.5 align-text-bottom text-gray-400"
          title={`Unknown icon: ${iconName}`}
        />
      );
    }
    
    lastIndex = match.index + match[0].length;
  }
  
  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  
  return parts.length > 0 ? parts : [text];
}

/**
 * Process children to replace :IconName: with actual react-icons.
 * Works recursively through all child elements.
 */
function processChildrenWithIcons(children: React.ReactNode): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child === "string") {
      return processTextWithIcons(child);
    }
    return child;
  });
}

/**
 * Custom components for ReactMarkdown
 */
const markdownComponents: Components = {
  // Code blocks and inline code
  code: ({ className, children, ...props }) => {
    const match = /language-(\w+)/.exec(className || "");
    const isInline = !match && !className;
    
    if (isInline) {
      return <InlineCode>{children}</InlineCode>;
    }
    
    return (
      <CodeBlock language={match?.[1]}>
        {String(children).replace(/\n$/, "")}
      </CodeBlock>
    );
  },
  
  // Don't wrap code blocks in pre (we handle it in CodeBlock)
  pre: ({ children }) => <>{children}</>,
  
  // Process text nodes for icons in paragraphs
  p: ({ children }) => (
    <p className="my-4 leading-7">
      {processChildrenWithIcons(children)}
    </p>
  ),
  
  // Headings with icon support
  h1: ({ children }) => (
    <h1 className="text-2xl font-bold mt-8 mb-4 text-gray-900 dark:text-neutral-100 border-b border-gray-200 dark:border-neutral-700 pb-2">
      {processChildrenWithIcons(children)}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-xl font-semibold mt-6 mb-3 text-gray-900 dark:text-neutral-100">
      {processChildrenWithIcons(children)}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-lg font-semibold mt-5 mb-2 text-gray-900 dark:text-neutral-100">
      {processChildrenWithIcons(children)}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-base font-semibold mt-4 mb-2 text-gray-900 dark:text-neutral-100">
      {processChildrenWithIcons(children)}
    </h4>
  ),
  h5: ({ children }) => (
    <h5 className="text-sm font-semibold mt-3 mb-1 text-gray-900 dark:text-neutral-100">
      {processChildrenWithIcons(children)}
    </h5>
  ),
  h6: ({ children }) => (
    <h6 className="text-sm font-medium mt-3 mb-1 text-gray-600 dark:text-neutral-400">
      {processChildrenWithIcons(children)}
    </h6>
  ),
  
  // Lists with icon support
  ul: ({ children }) => (
    <ul className="my-4 ml-6 list-disc space-y-2 marker:text-gray-400 dark:marker:text-neutral-500">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-4 ml-6 list-decimal space-y-2 marker:text-gray-500 dark:marker:text-neutral-400">
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li className="leading-7 text-gray-700 dark:text-neutral-300">
      {processChildrenWithIcons(children)}
    </li>
  ),
  
  // Blockquotes with icon support
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-4 border-blue-500 dark:border-neutral-500 pl-4 py-1 bg-blue-50 dark:bg-neutral-800/50 rounded-r-lg italic text-gray-700 dark:text-neutral-300">
      {processChildrenWithIcons(children)}
    </blockquote>
  ),
  
  // Horizontal rule
  hr: () => (
    <hr className="my-8 border-t border-gray-200 dark:border-neutral-700" />
  ),
  
  // Links
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 dark:text-neutral-300 hover:text-blue-800 dark:hover:text-neutral-200 underline decoration-blue-300 dark:decoration-neutral-500 underline-offset-2 hover:decoration-blue-500 transition-colors inline-flex items-center gap-0.5"
    >
      {children}
      <IoOpenOutline className="w-3 h-3 opacity-50" />
    </a>
  ),
  
  // Strong/Bold with icon support
  strong: ({ children }) => (
    <strong className="font-semibold text-gray-900 dark:text-neutral-100">
      {processChildrenWithIcons(children)}
    </strong>
  ),
  
  // Emphasis/Italic with icon support
  em: ({ children }) => (
    <em className="italic text-gray-800 dark:text-neutral-200">
      {processChildrenWithIcons(children)}
    </em>
  ),
  
  // Strikethrough with icon support
  del: ({ children }) => (
    <del className="line-through text-gray-500 dark:text-neutral-400">
      {processChildrenWithIcons(children)}
    </del>
  ),
  
  // Tables
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-lg border border-gray-200 dark:border-neutral-700">
      <table className="w-full text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-gray-50 dark:bg-neutral-800 border-b border-gray-200 dark:border-neutral-700">
      {children}
    </thead>
  ),
  tbody: ({ children }) => (
    <tbody className="divide-y divide-gray-100 dark:divide-neutral-800">{children}</tbody>
  ),
  tr: ({ children }) => (
    <tr className="hover:bg-gray-50 dark:hover:bg-neutral-800/50 transition-colors">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-neutral-300 uppercase tracking-wide">
      {processChildrenWithIcons(children)}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-4 py-3 text-gray-700 dark:text-neutral-300">
      {processChildrenWithIcons(children)}
    </td>
  ),
  
  // Images
  img: ({ src, alt }) => (
    <img
      src={src}
      alt={alt || ""}
      className="my-4 rounded-lg max-w-full h-auto border border-gray-200 dark:border-neutral-700 shadow-sm"
    />
  ),
};

// Memoize the remarkPlugins and rehypePlugins arrays to prevent recreation on every render
const REMARK_PLUGINS = [remarkGfm, remarkMath];
const REHYPE_PLUGINS = [rehypeKatex];

/**
 * Preprocess markdown text to convert ```math code blocks to ```mathblock
 * This prevents remark-math from interpreting them as LaTeX display math,
 * allowing them to render as proper code blocks instead.
 */
function preprocessMathCodeBlocks(text: string): string {
  // Match ```math at the start of a line (with optional whitespace before)
  // and replace with ```mathblock to avoid remark-math processing
  return text.replace(/^([ \t]*)```math\s*$/gm, "$1```mathblock");
}

/**
 * Image token cache - stores calculated token counts for image URLs
 * This allows us to calculate image tokens asynchronously and reuse them
 */
const imageTokenCache = new Map<string, number>();

/**
 * Calculate tokens for an image based on its dimensions.
 * 
 * According to Anthropic's documentation:
 * - tokens ≈ (width × height) / 750
 * - Images larger than 1568px on the longest edge are resized
 * - Maximum ~1,600 tokens per image after resizing
 * 
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @returns Estimated token count for the image
 */
function calculateImageTokens(width: number, height: number): number {
  // If image would be resized (longest edge > 1568px), calculate resized dimensions
  let effectiveWidth = width;
  let effectiveHeight = height;
  
  const maxDimension = 1568;
  const longestEdge = Math.max(width, height);
  
  if (longestEdge > maxDimension) {
    const scale = maxDimension / longestEdge;
    effectiveWidth = Math.floor(width * scale);
    effectiveHeight = Math.floor(height * scale);
  }
  
  // Calculate tokens: (width × height) / 750
  const tokens = Math.ceil((effectiveWidth * effectiveHeight) / 750);
  
  // Cap at ~1,600 tokens (Anthropic's max after resizing)
  return Math.min(tokens, 1600);
}

/**
 * Get image dimensions from a data URL asynchronously.
 * Caches the result to avoid recalculating.
 * 
 * @param dataUrl - The base64 data URL of the image
 * @returns Promise that resolves to the token count for the image
 */
async function getImageTokensFromUrl(dataUrl: string): Promise<number> {
  // Check cache first
  if (imageTokenCache.has(dataUrl)) {
    return imageTokenCache.get(dataUrl)!;
  }
  
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const tokens = calculateImageTokens(img.width, img.height);
      imageTokenCache.set(dataUrl, tokens);
      resolve(tokens);
    };
    img.onerror = () => {
      // Default to ~1000 tokens if we can't load the image
      const fallbackTokens = 1000;
      imageTokenCache.set(dataUrl, fallbackTokens);
      resolve(fallbackTokens);
    };
    img.src = dataUrl;
  });
}

/**
 * Extract all image URLs from messages for token calculation
 */
function extractImageUrls(messages: Array<{ parts?: Array<{ type: string; url?: string; mediaType?: string }> }>): string[] {
  const urls: string[] = [];
  
  for (const message of messages) {
    if (message.parts) {
      for (const part of message.parts) {
        if (part.type === "file" && part.mediaType?.startsWith("image/") && part.url) {
          urls.push(part.url);
        }
      }
    }
  }
  
  return urls;
}

/**
 * Estimate token count for messages (synchronous version using cache).
 * 
 * Claude models use a tokenizer similar to other modern LLMs.
 * A reasonable approximation is ~4 characters per token for English text,
 * though this varies based on content (code tends to have more tokens per char).
 * 
 * For images, uses Anthropic's formula: tokens ≈ (width × height) / 750
 * Image tokens are cached after first calculation.
 * 
 * This is an estimate - the official Anthropic tokenizer is not accurate
 * for Claude 3/4 models, so we use a heuristic approach.
 */
function estimateTokenCount(
  messages: Array<{ 
    role: string; 
    content?: string; 
    parts?: Array<{ type: string; text?: string; url?: string; mediaType?: string }> 
  }>,
  imageTokens: Map<string, number>
): number {
  let totalTokens = 0;
  
  for (const message of messages) {
    // Add role overhead (roughly 4 tokens per message for formatting)
    totalTokens += 4;
    
    // Handle direct content
    if (typeof message.content === "string") {
      totalTokens += Math.ceil(message.content.length / 4);
    }
    
    // Handle parts-based messages (AI SDK format)
    if (message.parts) {
      for (const part of message.parts) {
        if (part.type === "text" && part.text) {
          totalTokens += Math.ceil(part.text.length / 4);
        } else if (part.type === "tool-invocation") {
          // Tool calls add overhead - estimate ~50 tokens per tool call
          totalTokens += 50;
        } else if (part.type === "file" && part.mediaType?.startsWith("image/") && part.url) {
          // Get cached image tokens or use estimate
          const cachedTokens = imageTokens.get(part.url);
          if (cachedTokens !== undefined) {
            totalTokens += cachedTokens;
          } else {
            // Default estimate while loading: ~1000 tokens (roughly a 866x866 image)
            totalTokens += 1000;
          }
        }
      }
    }
  }
  
  return totalTokens;
}

/**
 * Format token count for display (e.g., "1.2k" for 1200)
 */
function formatTokenCount(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return count.toString();
}

// =============================================================================
// STREAMING-AWARE MARKDOWN CONTENT COMPONENT
// =============================================================================

/**
 * Streaming-aware markdown content component.
 * 
 * PERFORMANCE STRATEGY:
 * - During active streaming: Show plain text only (no markdown parsing at all)
 * - After streaming stops: Render full markdown with syntax highlighting
 * 
 * This prevents the browser from freezing when receiving large amounts of text,
 * as ReactMarkdown + SyntaxHighlighter are very expensive to run on every update.
 * 
 * The key insight is that we NEVER parse markdown during streaming - we just
 * display the raw text. This makes streaming smooth even for very long responses.
 */
interface StreamingMarkdownContentProps {
  text: string;
  isStreaming: boolean;
}

/**
 * Plain text component for streaming - extremely lightweight
 * Just renders text with whitespace preserved, no parsing at all
 */
const PlainTextContent = React.memo(
  function PlainTextContent({ text }: { text: string }) {
    return (
      <div className="max-w-none font-sans text-[15px] leading-7 text-gray-700 dark:text-neutral-300 whitespace-pre-wrap">
        {text}
      </div>
    );
  },
  (prev, next) => prev.text === next.text
);

/**
 * Main streaming-aware component
 * Switches between plain text (during streaming) and markdown (after complete)
 */
const StreamingMarkdownContent = React.memo(
  function StreamingMarkdownContent({ text, isStreaming }: StreamingMarkdownContentProps) {
    // During streaming, render plain text only - no markdown parsing
    if (isStreaming) {
      return <PlainTextContent text={text} />;
    }
    
    // Preprocess to convert ```math to ```mathblock before markdown parsing
    const processedText = preprocessMathCodeBlocks(text);
    
    // After streaming ends, render full markdown
    return (
      <div className="max-w-none font-sans text-[15px] leading-7 text-gray-700 dark:text-neutral-300">
        <ReactMarkdown 
          remarkPlugins={REMARK_PLUGINS}
          rehypePlugins={REHYPE_PLUGINS}
          components={markdownComponents}
        >
          {processedText}
        </ReactMarkdown>
      </div>
    );
  },
  // Custom comparison - re-render if text or streaming status changed
  (prevProps, nextProps) => 
    prevProps.text === nextProps.text && 
    prevProps.isStreaming === nextProps.isStreaming
);

// Legacy memoized component for non-streaming contexts (kept for compatibility)
interface MarkdownContentProps {
  text: string;
}

const MarkdownContent = React.memo(
  function MarkdownContent({ text }: MarkdownContentProps) {
    // Preprocess to convert ```math to ```mathblock before markdown parsing
    const processedText = preprocessMathCodeBlocks(text);
    
    return (
      <div className="max-w-none font-sans text-[15px] leading-7 text-gray-700 dark:text-neutral-300">
        <ReactMarkdown 
          remarkPlugins={REMARK_PLUGINS}
          rehypePlugins={REHYPE_PLUGINS}
          components={markdownComponents}
        >
          {processedText}
        </ReactMarkdown>
      </div>
    );
  },
  (prevProps, nextProps) => prevProps.text === nextProps.text
);

// =============================================================================
// TOOL UI COMPONENTS
// =============================================================================

/**
 * Import your tool UI components here:
 *
 * import { WeatherToolView } from "@/components/tools/weather-view";
 * import { SearchToolView } from "@/components/tools/search-view";
 */

// =============================================================================
// TYPES
// =============================================================================

/**
 * Helper type for tool invocation states.
 * AI SDK v6 uses these states to track tool execution progress.
 */
type ToolInvocationState =
  | "input-streaming"     // AI SDK v6: Tool input is being streamed (tokens arriving)
  | "input-available"     // AI SDK v6: Tool input is complete, tool is executing
  | "output-available"    // AI SDK v6: Tool has finished with output
  | "output-error"        // AI SDK v6: Tool execution failed
  | "approval-requested"  // Waiting for user approval (needsApproval: true)
  | "approved"            // User approved the tool call
  | "denied"              // User denied the tool call
  | "partial-call"        // Legacy: Model is still generating the tool call
  | "call"                // Legacy: Tool call is complete, ready to execute
  | "output-pending";     // Legacy: Tool is executing

interface ChatProps {
  /** Unique identifier for this chat session - used to isolate useChat state */
  chatId: string;
  conversationId: string | null;
  initialMessages?: UIMessage[];
  onMessagesChange?: (messages: UIMessage[]) => void;
  /** Called when streaming status changes - used to keep chat alive during streaming */
  onStreamingChange?: (isStreaming: boolean) => void;
  /** Called when the knowledge base changes - used to refresh the sidebar */
  onKnowledgeChange?: () => void;
  /** Called when AI generates a new title for the conversation */
  onTitleChange?: (title: string) => void;
  /** Whether the user is an owner with free API access */
  isOwner?: boolean;
  /** Called when settings modal needs to be opened (e.g., free trial exhausted) */
  onRequestSettings?: () => void;
  /** Callback when API keys change */
  onApiKeysChange?: (keys: StoredApiKeys) => void;
}

// =============================================================================
// MESSAGE EDITOR COMPONENT
// =============================================================================

/** Image part from a message - can be data URL or base64 */
interface MessageImagePart {
  mediaType: string;
  url?: string;
  data?: string;
}

interface MessageEditorProps {
  initialText: string;
  /** Initial images from the message being edited */
  initialImages?: MessageImagePart[];
  onSave: (newText: string, images: { file?: File; dataUrl: string; mediaType: string }[]) => void;
  onCancel: () => void;
  messagesAfterCount: number;
}

const MessageEditor = React.memo(function MessageEditor({ 
  initialText, 
  initialImages = [],
  onSave, 
  onCancel, 
  messagesAfterCount 
}: MessageEditorProps) {
  const [text, setText] = useState(initialText);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  
  // Image state - combines existing images and newly added ones
  // Each image has a dataUrl for display and optionally a File for new uploads
  const [images, setImages] = useState<{ file?: File; dataUrl: string; mediaType: string }[]>(() => {
    // Convert initial images to our format
    return initialImages.map(img => ({
      dataUrl: img.url || (img.data ? `data:${img.mediaType};base64,${img.data}` : ''),
      mediaType: img.mediaType,
    })).filter(img => img.dataUrl);
  });
  
  const [isDragging, setIsDragging] = useState(false);

  // Auto-resize textarea based on content
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 300)}px`;
    }
  }, [text]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(text.length, text.length);
    }
  }, []);
  
  // Convert File to data URL
  const fileToDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };
  
  // Add images from files
  const addImagesFromFiles = async (files: File[]) => {
    const imageFiles = files.filter(f => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    
    const newImages = await Promise.all(
      imageFiles.map(async (file) => ({
        file,
        dataUrl: await fileToDataUrl(file),
        mediaType: file.type,
      }))
    );
    
    setImages(prev => [...prev, ...newImages]);
  };
  
  // Remove an image by index
  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };
  
  // Drag and drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  };
  
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  };
  
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      await addImagesFromFiles(files);
    }
  };
  
  // Handle file input change
  const handleImageInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await addImagesFromFiles(Array.from(e.target.files));
    }
    e.target.value = "";
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (canSave) {
        onSave(text.trim(), images);
      }
    } else if (e.key === "Escape") {
      onCancel();
    }
  };
  
  // Compare initial state with current to determine if there are changes
  const initialImageUrls = initialImages.map(img => img.url || (img.data ? `data:${img.mediaType};base64,${img.data}` : '')).sort();
  const currentImageUrls = images.map(img => img.dataUrl).sort();
  const imagesChanged = JSON.stringify(initialImageUrls) !== JSON.stringify(currentImageUrls);
  const textChanged = text.trim() !== initialText.trim();
  const hasChanges = textChanged || imagesChanged;
  const canSave = (text.trim() || images.length > 0) && hasChanges;

  return (
    <div 
      className="w-full space-y-3 relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Hidden file input for image uploads */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleImageInputChange}
      />
      
      {/* Warning banner if there are messages after this one */}
      {messagesAfterCount > 0 && (
        <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/50 rounded-lg text-amber-800 dark:text-amber-200">
          <IoAlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div className="text-sm">
            <span className="font-medium">Editing will restart the conversation from here.</span>
            <span className="text-amber-600 dark:text-amber-300 ml-1">
              {messagesAfterCount} {messagesAfterCount === 1 ? 'message' : 'messages'} after this will be removed.
            </span>
          </div>
        </div>
      )}
      
      {/* Image previews - same style as main chat input */}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((img, index) => (
            <div
              key={`edit-img-${index}`}
              className="relative group"
            >
              <img
                src={img.dataUrl}
                alt={img.file?.name || `Image ${index + 1}`}
                className="h-16 w-auto rounded-lg border border-gray-200 dark:border-neutral-700 object-cover"
              />
              <button
                type="button"
                onClick={() => removeImage(index)}
                className="absolute -top-1.5 -right-1.5 p-1 bg-red-500 hover:bg-red-600 text-white rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <IoClose className="w-3 h-3" />
              </button>
              {img.file && (
                <span className="absolute bottom-0.5 left-0.5 right-0.5 text-[10px] text-white bg-black/50 rounded px-1 truncate">
                  {img.file.name}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      
      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-blue-50/90 dark:bg-blue-900/30 border-2 border-dashed border-blue-400 dark:border-blue-600 rounded-xl">
          <div className="text-center">
            <IoImage className="w-8 h-8 mx-auto text-blue-500 dark:text-blue-400 mb-2" />
            <p className="text-sm font-medium text-blue-600 dark:text-blue-400">Drop image here</p>
          </div>
        </div>
      )}
      
      {/* Textarea */}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        className="w-full min-h-[60px] max-h-[300px] resize-none text-[15px] leading-relaxed p-3 bg-white dark:bg-neutral-800 text-gray-900 dark:text-neutral-100 border border-gray-300 dark:border-neutral-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-neutral-500 focus:border-transparent"
        placeholder="Edit your message..."
      />
      
      {/* Action buttons */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-neutral-400">
            {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+Enter to save
          </span>
          {/* Add image button */}
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 dark:text-neutral-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors"
            title="Add image"
          >
            <IoImage className="w-3.5 h-3.5" />
            <span>Add image</span>
          </button>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-neutral-400 hover:text-gray-800 dark:hover:text-neutral-200 hover:bg-gray-100 dark:hover:bg-neutral-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => canSave && onSave(text.trim(), images)}
            disabled={!canSave}
            className={cn(
              "px-3 py-1.5 text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5",
              canSave
                ? "bg-blue-600 hover:bg-blue-700 text-white"
                : "bg-gray-100 dark:bg-neutral-700 text-gray-400 dark:text-neutral-500 cursor-not-allowed"
            )}
          >
            <IoRefresh className="w-3.5 h-3.5" />
            Save & Resend
          </button>
        </div>
      </div>
    </div>
  );
});

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function Chat({
  chatId,
  conversationId,
  initialMessages = [],
  onMessagesChange,
  onStreamingChange,
  onKnowledgeChange,
  onTitleChange,
  isOwner = false,
  onRequestSettings,
  onApiKeysChange,
}: ChatProps) {
  // ---------------------------------------------------------------------------
  // STATE
  // ---------------------------------------------------------------------------
  const [inputValue, setInputValue] = useState("");
  const [showContextDialog, setShowContextDialog] = useState(false);
  const [selectedSource, setSelectedSource] = useState("All Sources");
  const [mode, setMode] = useState("Auto");
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [attachedImages, setAttachedImages] = useState<{ file: File; previewUrl: string }[]>([]);
  const [pastedContent, setPastedContent] = useState<string | null>(null);
  const [showModeDropdown, setShowModeDropdown] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0); // Track drag enter/leave balance
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [userHasScrolledUp, setUserHasScrolledUp] = useState(false);
  const [isInputExpanded, setIsInputExpanded] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  
  // Knowledge Filesystem state
  const [rootFolders, setRootFolders] = useState<string[]>([]);
  
  // KB Summary for hybrid preload strategy (context engineering)
  // This summary is included in the system prompt so Claude knows what's available
  const [kbSummary, setKbSummary] = useState<string>("");
  
  // Parallel Context Saver tasks - tracks background agents saving to KB
  const [parallelTasks, setParallelTasks] = useState<Map<string, ParallelTask>>(new Map());
  
  // Agent Orchestrator - unified view of all agents being spawned
  const [orchestratorState, setOrchestratorState] = useState<OrchestratorState | null>(null);
  
  // Model selection state - "sonnet" = master, "opus" = grandmaster
  const [modelTier, setModelTier] = useState<ModelTier>("sonnet");
  
  // Image token cache for token count calculation
  // Maps image URLs to their calculated token counts
  const [imageTokens, setImageTokens] = useState<Map<string, number>>(new Map());
  
  // Ref to always have latest modelTier available (avoids stale closure in transport)
  const modelTierRef = useRef<ModelTier>(modelTier);
  useEffect(() => {
    modelTierRef.current = modelTier;
  }, [modelTier]);

  // ---------------------------------------------------------------------------
  // AUTHENTICATION & API KEYS (BYOK)
  // ---------------------------------------------------------------------------
  
  // Get session from Better Auth
  const { data: session } = useSession();
  const userId = session?.user?.id;
  
  // API keys state - loaded from localStorage (user-scoped if logged in)
  const [apiKeys, setApiKeys] = useState<StoredApiKeys>({});
  
  // Free trial state
  const [freeChatsRemaining, setFreeChatsRemaining] = useState(() => getFreeChatsRemaining());
  const [showTrialExhausted, setShowTrialExhausted] = useState(false);
  
  // Ref to always have latest apiKeys available (avoids stale closure)
  const apiKeysRef = useRef<StoredApiKeys>(apiKeys);
  useEffect(() => {
    apiKeysRef.current = apiKeys;
  }, [apiKeys]);
  
  // Load API keys from localStorage on mount and when user changes
  useEffect(() => {
    const keys = getApiKeys(userId);
    setApiKeys(keys);
  }, [userId]);
  
  // Handle API keys change from settings modal
  const handleApiKeysChange = useCallback((keys: StoredApiKeys) => {
    setApiKeys(keys);
    onApiKeysChange?.(keys);
    // If user adds API key, hide trial exhausted message
    if (keys.anthropicApiKey) {
      setShowTrialExhausted(false);
    }
  }, [onApiKeysChange]);
  
  // Ref to track if we should use free trial for the next request
  const useFreeTrialRef = useRef(false);
  
  // Check if user can send messages (has access)
  const canSendMessage = useCallback((): boolean => {
    // Owners always have access
    if (isOwner) return true;
    // Users with their own API key have access
    if (apiKeys.anthropicApiKey) return true;
    // Check free trial
    return hasFreeChatRemaining();
  }, [isOwner, apiKeys.anthropicApiKey]);
  
  // Handle access check before sending - returns true if allowed
  // Also sets the useFreeTrialRef for the transport to use
  const checkAccessAndProceed = useCallback((): boolean => {
    // Reset free trial flag
    useFreeTrialRef.current = false;
    
    // Owners always have access (uses env key)
    if (isOwner) return true;
    
    // Users with their own API key have access
    if (apiKeys.anthropicApiKey) return true;
    
    // Check free trial
    if (hasFreeChatRemaining()) {
      // Use owner's API key for free trial
      useFreeTrialRef.current = true;
      // Increment free chat count
      incrementFreeChatCount();
      setFreeChatsRemaining(getFreeChatsRemaining());
      return true;
    }
    
    // Free trial exhausted - show settings
    setShowTrialExhausted(true);
    onRequestSettings?.();
    return false;
  }, [isOwner, apiKeys.anthropicApiKey, onRequestSettings]);

  // ---------------------------------------------------------------------------
  // FILE HANDLING
  // ---------------------------------------------------------------------------
  const readFileAsText = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });

  const readPdfAsText = async (file: File) => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf");
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
        import.meta.url
      ).toString();
    }
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    const maxPages = Math.min(pdf.numPages, 30);
    const pageTexts: string[] = [];

    for (let pageIndex = 1; pageIndex <= maxPages; pageIndex += 1) {
      const page = await pdf.getPage(pageIndex);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item) => ("str" in item ? item.str : ""))
        .filter(Boolean)
        .join(" ");
      pageTexts.push(pageText);
    }

    return pageTexts.join("\n");
  };

  const buildAttachmentContext = async (files: File[]) => {
    const maxChars = 60_000;
    const chunks: string[] = [];

    for (const file of files) {
      const header = `Attached file: ${file.name}\nType: ${file.type || "unknown"}\nSize: ${file.size} bytes`;
      let content = "";

      if (file.type === "application/pdf") {
        content = await readPdfAsText(file);
      } else if (
        file.type.startsWith("text/") ||
        file.type === "application/json" ||
        file.type === "application/xml"
      ) {
        content = await readFileAsText(file);
      } else {
        content = "[Binary file attached — text extraction not supported]";
      }

      if (content.length > maxChars) {
        content = `${content.slice(0, maxChars)}\n...[truncated ${content.length - maxChars} chars]`;
      }

      chunks.push(`${header}\nContent:\n${content}`);
    }

    return chunks.join("\n\n");
  };

  /**
   * Extract text content from a message's parts
   */
  const extractMessageText = (message: ChatAgentUIMessage): string => {
    if (!message.parts) return "";
    return message.parts
      .filter((p) => p.type === "text")
      .map((p) => (p as { type: "text"; text: string }).text)
      .join("\n");
  };

  // ---------------------------------------------------------------------------
  // KNOWLEDGE FILESYSTEM
  // ---------------------------------------------------------------------------

  // Load root folders and KB summary on mount
  // This enables the hybrid preload strategy: summary in prompt, full retrieval on-demand
  useEffect(() => {
    kb.getRootFolders().then(setRootFolders);
    kb.generateKBSummary().then(setKbSummary);
  }, []);

  // Refresh root folders and KB summary after KB changes
  // Keeps the summary up-to-date for accurate context engineering
  const refreshRootFolders = useCallback(() => {
    kb.getRootFolders().then((folders) => {
      setRootFolders(folders);
      onKnowledgeChange?.();
    });
    // Also refresh the KB summary for hybrid preload
    kb.generateKBSummary().then(setKbSummary);
  }, [onKnowledgeChange]);

  // ---------------------------------------------------------------------------
  // AGENT ORCHESTRATOR MANAGEMENT
  // ---------------------------------------------------------------------------

  // Track the current orchestrator session ID for grouping related agents
  const orchestratorSessionRef = useRef<string | null>(null);
  // Track timeout for auto-closing orchestrator after inactivity
  const orchestratorTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Get or create an orchestrator session.
   * Sessions group agents that are spawned close together in time.
   * A new session starts if no agents have been added for 5 seconds.
   */
  const getOrCreateOrchestrator = useCallback(() => {
    // Clear any pending timeout
    if (orchestratorTimeoutRef.current) {
      clearTimeout(orchestratorTimeoutRef.current);
      orchestratorTimeoutRef.current = null;
    }

    // Check if we have an active orchestrator
    if (orchestratorState?.isActive && orchestratorSessionRef.current) {
      return orchestratorSessionRef.current;
    }

    // Create a new orchestrator
    const orchestratorId = `orch-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    orchestratorSessionRef.current = orchestratorId;
    setOrchestratorState({
      orchestratorId,
      totalAgents: 0, // Will be updated as agents register
      agents: [],
      startTime: Date.now(),
      isActive: true,
    });
    return orchestratorId;
  }, [orchestratorState?.isActive]);

  /**
   * Register an agent with the orchestrator.
   * Dynamically increases totalAgents count as new agents are added.
   * Enforces MAX_AGENTS cap (currently 6).
   */
  const registerAgent = useCallback((agent: AgentTask) => {
    // Ensure we have an orchestrator
    getOrCreateOrchestrator();

    setOrchestratorState((prev) => {
      if (!prev) return prev;
      
      // Check if agent already exists
      const exists = prev.agents.some((a) => a.id === agent.id);
      if (exists) return prev;
      
      // Enforce MAX_AGENTS cap
      if (prev.agents.length >= MAX_AGENTS) {
        console.warn(`[Orchestrator] Max agents (${MAX_AGENTS}) reached, skipping registration`);
        return prev;
      }
      
      // Add agent and increment total count
      return {
        ...prev,
        totalAgents: Math.min(prev.totalAgents + 1, MAX_AGENTS),
        agents: [...prev.agents, agent],
      };
    });
  }, [getOrCreateOrchestrator]);

  /**
   * Update an agent's status in the orchestrator.
   */
  const updateAgentStatus = useCallback((agentId: string, status: AgentStatus, description?: string) => {
    setOrchestratorState((prev) => {
      if (!prev) return prev;
      const updatedAgents = prev.agents.map((a) =>
        a.id === agentId ? { ...a, status, description: description ?? a.description } : a
      );
      // Check if all agents are done
      const allDone = updatedAgents.length > 0 && 
        updatedAgents.every((a) => a.status === "complete" || a.status === "error");
      
      // If all done, set a timeout to reset the orchestrator session
      if (allDone && orchestratorTimeoutRef.current === null) {
        orchestratorTimeoutRef.current = setTimeout(() => {
          orchestratorSessionRef.current = null;
          orchestratorTimeoutRef.current = null;
        }, 10000); // Reset session after 10s of completion
      }
      
      return {
        ...prev,
        agents: updatedAgents,
        isActive: !allDone,
      };
    });
  }, []);

  /**
   * Spawn a parallel Context Saver agent to save information in the background.
   * This fires off a request to /api/context-saver and processes the streaming response.
   */
  const spawnContextSaver = useCallback(
    async (taskId: string, information: string, context?: string) => {
      // Generate a descriptive name based on context
      const agentName = context 
        ? `Context Saver (${context})`
        : "Context Saver";

      // Register this context saver as an agent (auto-creates orchestrator if needed)
      registerAgent({
        id: taskId,
        name: agentName,
        type: "context-saver",
        status: "running",
        description: information.slice(0, 50) + (information.length > 50 ? "..." : ""),
      });

      // Initialize the task
      setParallelTasks((prev) => {
        const next = new Map(prev);
        next.set(taskId, {
          taskId,
          type: "context-save",
          status: "running",
          streamedText: "",
        });
        return next;
      });

      try {
        const response = await fetch("/api/context-saver", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            information,
            context,
            rootFolders,
            taskId,
            // BYOK: Include user's API key if they have one
            anthropicApiKey: apiKeysRef.current.anthropicApiKey,
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body");
        }

        const decoder = new TextDecoder();
        let savedPath: string | undefined;

        // Process the streaming response
        // AI SDK v6 streamText uses SSE format with "data:" prefix
        // Events include: text-delta (text), tool-input-available (tool calls)
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          
          // Parse SSE events from the chunk
          const lines = chunk.split("\n");
          for (const line of lines) {
            // Handle standard SSE data: prefix
            let jsonStr: string | null = null;
            if (line.startsWith("data:")) {
              jsonStr = line.slice(5).trim();
            } else if (line.startsWith("d:")) {
              // Legacy/alternate format
              jsonStr = line.slice(2).trim();
            }
            
            if (!jsonStr || jsonStr === "[DONE]") continue;
            
            try {
              const data = JSON.parse(jsonStr);
              
              // Extract text content from the message
              // AI SDK v6 uses text-delta with delta field
              if (data.type === "text-delta") {
                const text = data.delta || data.textDelta || "";
                if (text) {
                  setParallelTasks((prev) => {
                    const next = new Map(prev);
                    const task = next.get(taskId);
                    if (task) {
                      next.set(taskId, {
                        ...task,
                        streamedText: task.streamedText + text,
                      });
                    }
                    return next;
                  });
                }
              }
              
              // Handle tool input available - this is when tool call args are ready
              // AI SDK v6 uses tool-input-available with input field
              if (data.type === "tool-input-available") {
                const toolName = data.toolName as string;
                const args = data.input || {};
                
                // Extract saved path for UI
                if (toolName === "kb_write" || toolName === "kb_append") {
                  savedPath = args.path as string;
                }
                
                // Execute the tool client-side
                try {
                  switch (toolName) {
                    case "kb_list":
                      await kb.listFolder(args.path as string);
                      break;
                    case "kb_read":
                      await kb.readFile(args.path as string);
                      break;
                    case "kb_write":
                      await kb.writeFile(args.path as string, args.content as string);
                      refreshRootFolders();
                      break;
                    case "kb_append":
                      await kb.appendFile(args.path as string, args.content as string);
                      break;
                    case "kb_mkdir":
                      await kb.mkdir(args.path as string);
                      refreshRootFolders();
                      break;
                  }
                } catch (err) {
                  console.error(`[Context Saver] Tool ${toolName} failed:`, err);
                }
              }
              
              // Also handle legacy tool-call format for backwards compatibility
              if (data.type === "tool-call") {
                const toolName = data.toolName as string;
                const args = data.args || data.input || {};
                
                if (toolName === "kb_write" || toolName === "kb_append") {
                  savedPath = args.path as string;
                }
                
                try {
                  switch (toolName) {
                    case "kb_list":
                      await kb.listFolder(args.path as string);
                      break;
                    case "kb_read":
                      await kb.readFile(args.path as string);
                      break;
                    case "kb_write":
                      await kb.writeFile(args.path as string, args.content as string);
                      refreshRootFolders();
                      break;
                    case "kb_append":
                      await kb.appendFile(args.path as string, args.content as string);
                      break;
                    case "kb_mkdir":
                      await kb.mkdir(args.path as string);
                      refreshRootFolders();
                      break;
                  }
                } catch (err) {
                  console.error(`[Context Saver] Tool ${toolName} failed:`, err);
                }
              }
            } catch {
              // Ignore JSON parse errors for incomplete chunks
            }
          }
        }

        // Mark task as complete
        setParallelTasks((prev) => {
          const next = new Map(prev);
          const task = next.get(taskId);
          if (task) {
            next.set(taskId, {
              ...task,
              status: "complete",
              savedPath,
            });
          }
          return next;
        });
        // Update orchestrator
        updateAgentStatus(taskId, "complete", savedPath ? `Saved to ${savedPath}` : undefined);
      } catch (error) {
        // Mark task as error
        setParallelTasks((prev) => {
          const next = new Map(prev);
          const task = next.get(taskId);
          if (task) {
            next.set(taskId, {
              ...task,
              status: "error",
              error: error instanceof Error ? error.message : String(error),
            });
          }
          return next;
        });
        // Update orchestrator
        updateAgentStatus(taskId, "error", error instanceof Error ? error.message : String(error));
        console.error("[Context Saver] Error:", error);
      }
    },
    [rootFolders, refreshRootFolders, registerAgent, updateAgentStatus]
  );

  // Tool output function - will be set after useChat initializes
  const addToolOutputRef = useRef<((params: { tool: string; toolCallId: string; output: unknown }) => void) | null>(null);

  /**
   * Handle tool calls from the AI model.
   * Knowledge tools are executed client-side since IndexedDB runs in the browser.
   * We use addToolOutput to return results back to the chat.
   *
   * save_to_context spawns a parallel Context Saver agent that runs in the background.
   */
  /**
   * Execute a single tool and call addToolOutput when done.
   * This is called asynchronously (fire-and-forget) to enable parallel tool execution.
   */
  const executeToolAsync = useCallback(
    async (toolName: string, toolCallId: string, args: Record<string, unknown>) => {
      let output: unknown;

      try {
        switch (toolName) {
          case "save_to_context": {
            // Generate a unique task ID
            const taskId = `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
            
            // Spawn the parallel agent (fire-and-forget)
            spawnContextSaver(
              taskId,
              args.information as string,
              args.context as string | undefined
            );
            
            // Return immediately so the main agent can continue
            output = { taskId, status: "started" };
            break;
          }
          case "kb_list": {
            // XML-wrapped output for better context engineering
            // Semantic tags help Claude distinguish between different retrieved content
            const items = await kb.listFolder(args.path as string);
            const xmlOutput = `<folder_listing path="${args.path}">
${items.map((i) => `<item>${i}</item>`).join("\n")}
</folder_listing>`;
            output = { listing: xmlOutput, contents: items };
            break;
          }
          case "kb_read": {
            // XML-wrapped document with source attribution for quote-grounding
            // This enables the quote-first-then-answer pattern (improves accuracy by 20%+)
            const content = await kb.readFile(args.path as string);
            const xmlOutput = `<document source="${args.path}" type="knowledge_base_file">
<document_content>
${content}
</document_content>
</document>`;
            output = { document: xmlOutput, content };
            break;
          }
          case "kb_write": {
            await kb.writeFile(args.path as string, args.content as string);
            refreshRootFolders();
            output = { success: true };
            break;
          }
          case "kb_append": {
            await kb.appendFile(args.path as string, args.content as string);
            output = { success: true };
            break;
          }
          case "kb_mkdir": {
            await kb.mkdir(args.path as string);
            refreshRootFolders();
            output = { success: true };
            break;
          }
          case "kb_delete": {
            await kb.deleteNode(args.path as string);
            refreshRootFolders();
            output = { success: true };
            break;
          }
          case "kb_search": {
            // Hybrid search (lexical + semantic + RRF) across knowledge base with optional reranking
            const query = args.query as string;
            const topK = Math.min((args.topK as number) || 5, 25);
            const results = await kb.hybridSearch(query, { 
              topK, 
              includeBreakdown: true,
              rerank: true, // Auto-detect reranker availability
            });
            
            if (results.length === 0) {
              output = {
                results: [],
                message: "No matching content found in knowledge base. Try a different query or check if knowledge base is empty.",
              };
            } else {
              // XML-formatted output for better context engineering
              // Include matched terms and rerank indicator for transparency
              const xmlOutput = `<search_results source="knowledge_base" query="${query}" mode="${results[0]?.queryType || 'mixed'}">
${results.map((r) => {
  const matchedTermsAttr = r.matchedTerms?.length > 0 
    ? ` matched_terms="${r.matchedTerms.join(', ')}"` 
    : '';
  const rerankedAttr = r.reranked ? ' reranked="true"' : '';
  return `<result score="${r.score}" file="${r.filePath}" heading="${r.headingPath}"${matchedTermsAttr}${rerankedAttr}>
<chunk_text>
${r.chunkText}
</chunk_text>
</result>`;
}).join("\n")}
</search_results>`;
              output = { search_results: xmlOutput, results };
            }
            break;
          }
          case "chat_search": {
            // Hybrid search across chat history (lexical + semantic + RRF)
            const { chatHybridSearch } = await import("@/lib/storage/chat-hybrid-search");
            const query = args.query as string;
            const topK = Math.min((args.topK as number) || 5, 25);
            const results = await chatHybridSearch(query, { 
              topK, 
              includeBreakdown: true,
              rerank: true,
            });
            
            if (results.length === 0) {
              output = {
                results: [],
                message: "No matching content found in chat history. Try a different query or there may not be relevant past conversations.",
              };
            } else {
              // XML-formatted output with matched terms and query type
              const queryType = results[0]?.queryType || "mixed";
              const xmlOutput = `<search_results source="chat_history" query="${query}" mode="${queryType}">
${results.map((r) => {
  const matchedTermsAttr = r.matchedTerms && r.matchedTerms.length > 0 
    ? ` matched_terms="${r.matchedTerms.join(', ')}"` 
    : '';
  const rerankedAttr = r.reranked ? ' reranked="true"' : '';
  return `<result score="${r.score}" conversation="${r.conversationTitle}" role="${r.messageRole}"${matchedTermsAttr}${rerankedAttr}>
<chunk_text>
${r.chunkText}
</chunk_text>
</result>`;
}).join("\n")}
</search_results>`;
              output = { search_results: xmlOutput, results };
            }
            break;
          }
          case "document_search": {
            // Hybrid search across uploaded large documents (lexical + semantic + RRF)
            const { searchLargeDocuments, searchLargeDocument } = await import("@/knowledge/large-documents");
            const query = args.query as string;
            const topK = Math.min((args.topK as number) || 10, 25);
            const documentId = args.documentId as string | undefined;
            
            const searchOptions = { 
              topK, 
              includeBreakdown: true,
              rerank: true,
            };
            
            const results = documentId
              ? await searchLargeDocument(documentId, query, searchOptions)
              : await searchLargeDocuments(query, searchOptions);
            
            if (results.length === 0) {
              output = {
                results: [],
                message: "No matching content found in uploaded documents. The user may need to upload a document first via the Large Documents section in the sidebar.",
              };
            } else {
              // XML-formatted output with matched terms and query type
              const queryType = results[0]?.queryType || "mixed";
              const xmlOutput = `<search_results source="large_documents" query="${query}" mode="${queryType}">
${results.map((r) => {
  const matchedTermsAttr = r.matchedTerms && r.matchedTerms.length > 0 
    ? ` matched_terms="${r.matchedTerms.join(', ')}"` 
    : '';
  const rerankedAttr = r.reranked ? ' reranked="true"' : '';
  return `<result score="${r.score}" document="${r.filename}" heading="${r.headingPath}"${matchedTermsAttr}${rerankedAttr}>
<chunk_text>
${r.chunkText}
</chunk_text>
</result>`;
}).join("\n")}
</search_results>`;
              output = { search_results: xmlOutput, results };
            }
            break;
          }
          case "document_list": {
            // List all uploaded large documents
            const { getAllLargeDocuments } = await import("@/knowledge/large-documents");
            const documents = await getAllLargeDocuments();
            
            if (documents.length === 0) {
              output = {
                documents: [],
                message: "No documents have been uploaded yet. The user can upload documents via the Large Documents section in the sidebar.",
              };
            } else {
              // XML-formatted output for document list
              const xmlOutput = `<documents count="${documents.length}">
${documents.map((d) => {
  return `<document id="${d.id}" filename="${d.filename}" status="${d.status}" chunks="${d.chunkCount}" size="${d.fileSize}" />`;
}).join("\n")}
</documents>`;
              output = { documents_xml: xmlOutput, documents };
            }
            break;
          }
          // =============================================================================
          // KNOWLEDGE GRAPH TOOLS
          // =============================================================================
          case "kb_link": {
            // Create a relationship between two files
            const result = await kb.createLink(
              args.source as string,
              args.target as string,
              args.relationship as kb.RelationshipType,
              {
                bidirectional: args.bidirectional as boolean | undefined,
                notes: args.notes as string | undefined,
              }
            );
            output = result;
            break;
          }
          case "kb_unlink": {
            // Remove a relationship between two files
            const result = await kb.deleteLink(
              args.source as string,
              args.target as string,
              args.relationship as kb.RelationshipType
            );
            output = result;
            break;
          }
          case "kb_links": {
            // Query all links for a file
            const result = await kb.getLinksForFile(args.path as string);
            
            // XML-formatted output for context engineering
            const xmlOutput = `<file_links path="${result.path}" total="${result.total}">
<outgoing count="${result.outgoing.length}">
${result.outgoing.map((l) => `<link target="${l.target}" relationship="${l.relationship}"${l.bidirectional ? ' bidirectional="true"' : ''}${l.notes ? ` notes="${l.notes}"` : ''} />`).join("\n")}
</outgoing>
<incoming count="${result.incoming.length}">
${result.incoming.map((l) => `<link source="${l.source}" relationship="${l.relationship}"${l.bidirectional ? ' bidirectional="true"' : ''}${l.notes ? ` notes="${l.notes}"` : ''} />`).join("\n")}
</incoming>
</file_links>`;
            output = { links_xml: xmlOutput, ...result };
            break;
          }
          case "kb_graph": {
            // Traverse the knowledge graph
            const result = await kb.traverseGraph(
              args.startPath as string,
              {
                depth: args.depth as number | undefined,
                relationship: args.relationship as kb.RelationshipType | undefined,
                direction: args.direction as "outgoing" | "incoming" | "both" | undefined,
              }
            );
            
            // XML-formatted output for context engineering
            const xmlOutput = `<graph_traversal root="${result.rootPath}" depth="${result.depth}" total_links="${result.totalLinks}">
${result.nodes.map((n) => `<node path="${n.path}">
${n.links.outgoing.length > 0 ? `<outgoing>${n.links.outgoing.map((l) => `<link target="${l.target}" relationship="${l.relationship}" />`).join("")}</outgoing>` : ''}
${n.links.incoming.length > 0 ? `<incoming>${n.links.incoming.map((l) => `<link source="${l.source}" relationship="${l.relationship}" />`).join("")}</incoming>` : ''}
</node>`).join("\n")}
</graph_traversal>`;
            output = { graph_xml: xmlOutput, ...result };
            break;
          }
          // =============================================================================
          // PDF EXPORT TOOL
          // =============================================================================
          case "pdf_export": {
            // Export recent chat messages as PDF with markdown/LaTeX formatting
            const { generateChatPdf } = await import("@/lib/pdf-generator");
            const result = await generateChatPdf(messages, {
              filename: args.filename as string | undefined,
              title: args.title as string | undefined,
              messageCount: args.messageCount as number | undefined,
              includeUserMessages: args.includeUserMessages as boolean | undefined,
              includeAssistantMessages: args.includeAssistantMessages as boolean | undefined,
            });
            output = result;
            break;
          }
          default:
            output = { error: `Unknown tool: ${toolName}` };
        }
      } catch (error) {
        output = { error: error instanceof Error ? error.message : String(error) };
      }

      // Send tool output back to the chat
      if (addToolOutputRef.current) {
        addToolOutputRef.current({ tool: toolName, toolCallId, output });
      }
    },
    [refreshRootFolders, spawnContextSaver]
  );

  /**
   * Handle tool calls from the AI model.
   * 
   * PARALLEL EXECUTION: This function does NOT await the tool execution.
   * Instead, it fires off the execution asynchronously and returns immediately.
   * This allows multiple tool calls to execute in parallel.
   * 
   * The actual tool output is sent via addToolOutput when the async operation completes.
   */
  const handleToolCall = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ toolCall }: { toolCall: any }) => {
      const toolName = toolCall.toolName as string;
      const toolCallId = toolCall.toolCallId as string;
      const args = (toolCall.input ?? {}) as Record<string, unknown>;

      // Fire-and-forget: start execution but don't await
      // This enables parallel execution of multiple tool calls
      executeToolAsync(toolName, toolCallId, args);
      
      // Return immediately - the SDK will wait for addToolOutput to be called
    },
    [executeToolAsync]
  );

  // ---------------------------------------------------------------------------
  // CHAT TRANSPORT & HOOK
  // ---------------------------------------------------------------------------

  /**
   * Transport configuration for the chat API.
   * 
   * CONTEXT ENGINEERING:
   * - rootFolders: List of KB folders for XML structure in system prompt
   * - kbSummary: Pre-generated summary for hybrid preload strategy
   * 
   * This enables Claude to see what's available (summary) while using
   * just-in-time retrieval (tools) for full content.
   */
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({
          id,
          messages,
          trigger,
          messageId,
        }: any) => ({
          body: {
            id,
            messages,
            trigger,
            messageId,
            chatId,
            rootFolders,
            kbSummary,
            // Use ref to always get latest modelTier (avoids stale closure)
            modelTier: modelTierRef.current,
            // BYOK: Include user's API key if they have one
            anthropicApiKey: apiKeysRef.current.anthropicApiKey,
            // Free trial: use owner's API key for first 5 chats
            useFreeTrial: useFreeTrialRef.current,
          },
        }),
      } as any),
    [chatId, rootFolders, kbSummary]
  );

  /**
   * useChat hook with typed messages for full type safety.
   *
   * The generic parameter ChatAgentUIMessage provides:
   * - Typed message.parts with tool invocations
   * - Type-safe tool input/output access
   * - Autocomplete for tool names
   *
   * CRITICAL: The `id` parameter isolates this chat's state from other chats.
   * Without it, all useChat instances share state and streaming responses
   * will bleed across conversations.
   *
   * We use onFinish to sync messages to localStorage after each response.
   * onToolCall handles client-side tool execution for the Knowledge Filesystem.
   */
  const {
    messages,
    setMessages,
    sendMessage,
    status,
    error,
    addToolApprovalResponse,
    addToolOutput,
  } = useChat<ChatAgentUIMessage>({
    id: chatId, // Unique ID per chat - isolates state for parallel chats
    transport,
    messages: initialMessages as ChatAgentUIMessage[], // v6 uses 'messages' instead of 'initialMessages'
    onToolCall: handleToolCall,
    // CRITICAL: This tells useChat to automatically continue the conversation
    // after all tool outputs are provided, enabling multi-step tool chains
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onError: (err) => {
      console.error("Chat error:", err);
    },
    onFinish: async ({ messages: finishedMessages }) => {
      // Sync messages to parent after AI response completes
      if (onMessagesChange) {
        onMessagesChange(finishedMessages);
      }

      // Generate an AI title for the conversation after each response
      // This runs in the background and doesn't block the UI
      if (onTitleChange && finishedMessages.length >= 2) {
        try {
          const response = await fetch("/api/generate-title", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
              messages: finishedMessages,
              // BYOK: Include user's API key if they have one
              anthropicApiKey: apiKeysRef.current.anthropicApiKey,
            }),
          });
          
          if (response.ok) {
            const { title } = await response.json();
            if (title && typeof title === "string") {
              onTitleChange(title);
            }
          }
        } catch (error) {
          // Title generation is non-critical, fail silently
          console.warn("[Chat] Failed to generate title:", error);
        }
      }
    },
  });

  // Store addToolOutput in ref so handleToolCall can access it
  useEffect(() => {
    addToolOutputRef.current = addToolOutput;
  }, [addToolOutput]);

  const isLoading = status === "streaming" || status === "submitted";

  // Calculate estimated token count for the current conversation
  const tokenCount = useMemo(() => estimateTokenCount(messages, imageTokens), [messages, imageTokens]);
  
  // Effect to calculate image tokens asynchronously
  useEffect(() => {
    const imageUrls = extractImageUrls(messages);
    const uncachedUrls = imageUrls.filter(url => !imageTokens.has(url));
    
    if (uncachedUrls.length === 0) return;
    
    // Calculate tokens for all uncached images
    Promise.all(
      uncachedUrls.map(async (url) => {
        const tokens = await getImageTokensFromUrl(url);
        return { url, tokens };
      })
    ).then((results) => {
      setImageTokens(prev => {
        const next = new Map(prev);
        for (const { url, tokens } of results) {
          next.set(url, tokens);
        }
        return next;
      });
    });
  }, [messages, imageTokens]);

  // Track if this is the initial mount to prevent message sync loops
  const isInitialMount = useRef(true);
  
  // Track previous streaming state to detect changes
  const wasStreamingRef = useRef(false);

  // ---------------------------------------------------------------------------
  // EFFECTS
  // ---------------------------------------------------------------------------

  // Handle scroll events to detect if user scrolled up
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    
    // Check if user is near the bottom (within 100px)
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
    setUserHasScrolledUp(!isNearBottom);
  }, []);

  // Throttled scroll to prevent excessive scrollIntoView calls during streaming
  // This dramatically improves performance when receiving large amounts of text
  const lastScrollTimeRef = useRef<number>(0);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const SCROLL_THROTTLE_MS = 100; // Only scroll at most every 100ms during streaming

  const scrollToBottom = useCallback((immediate = false) => {
    const now = Date.now();
    const timeSinceLastScroll = now - lastScrollTimeRef.current;

    // Clear any pending scroll
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = null;
    }

    if (immediate || timeSinceLastScroll >= SCROLL_THROTTLE_MS) {
      // Scroll immediately
      lastScrollTimeRef.current = now;
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    } else {
      // Schedule a scroll for later
      scrollTimeoutRef.current = setTimeout(() => {
        lastScrollTimeRef.current = Date.now();
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        scrollTimeoutRef.current = null;
      }, SCROLL_THROTTLE_MS - timeSinceLastScroll);
    }
  }, []);

  // Cleanup scroll timeout on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  // Scroll to bottom on new messages (only if user hasn't scrolled up)
  // Uses throttled scroll during streaming to prevent jank
  useEffect(() => {
    if (!userHasScrolledUp) {
      scrollToBottom(false);
    }
  }, [messages, userHasScrolledUp, scrollToBottom]);

  // Always scroll to bottom when streaming starts (user sends a message)
  useEffect(() => {
    if (isLoading) {
      setUserHasScrolledUp(false);
      scrollToBottom(true); // Immediate scroll when starting
    }
  }, [isLoading, scrollToBottom]);

  // Report streaming status changes to parent
  // This allows the parent to keep this chat instance alive while streaming
  // Use ref for callback to avoid dependency issues
  const onStreamingChangeRef = useRef(onStreamingChange);
  useEffect(() => {
    onStreamingChangeRef.current = onStreamingChange;
  }, [onStreamingChange]);

  useEffect(() => {
    if (onStreamingChangeRef.current && wasStreamingRef.current !== isLoading) {
      wasStreamingRef.current = isLoading;
      onStreamingChangeRef.current(isLoading);
    }
  }, [isLoading]);

  // Sync user messages to parent when they send a message
  // (onFinish handles assistant messages)
  // We use a ref to store the callback to avoid it being a dependency
  const onMessagesChangeRef = useRef(onMessagesChange);
  useEffect(() => {
    onMessagesChangeRef.current = onMessagesChange;
  }, [onMessagesChange]);

  // Ref for title change callback (avoids stale closures)
  const onTitleChangeRef = useRef(onTitleChange);
  useEffect(() => {
    onTitleChangeRef.current = onTitleChange;
  }, [onTitleChange]);

  // Track the last synced message count to avoid duplicate syncs
  const lastSyncedLengthRef = useRef(initialMessages.length);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    // Only sync when user sends a message (status === "submitted")
    // and only if message count actually changed
    if (
      onMessagesChangeRef.current &&
      messages.length > 0 &&
      messages.length !== lastSyncedLengthRef.current &&
      status === "submitted"
    ) {
      lastSyncedLengthRef.current = messages.length;
      onMessagesChangeRef.current(messages);
    }
  }, [messages.length, status, messages, initialMessages.length]);

  // Auto-save during streaming to prevent data loss on crash
  // Saves every 2 seconds while streaming is active
  const streamingSaveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastStreamingSaveRef = useRef<string>("");
  
  useEffect(() => {
    if (isLoading && messages.length > 0) {
      // Start periodic saving during streaming
      streamingSaveIntervalRef.current = setInterval(() => {
        if (onMessagesChangeRef.current) {
          // Only save if content actually changed (avoid unnecessary writes)
          const currentContent = JSON.stringify(messages);
          if (currentContent !== lastStreamingSaveRef.current) {
            lastStreamingSaveRef.current = currentContent;
            onMessagesChangeRef.current(messages);
          }
        }
      }, 2000); // Save every 2 seconds during streaming
    } else {
      // Clear interval when not streaming
      if (streamingSaveIntervalRef.current) {
        clearInterval(streamingSaveIntervalRef.current);
        streamingSaveIntervalRef.current = null;
      }
    }
    
    return () => {
      if (streamingSaveIntervalRef.current) {
        clearInterval(streamingSaveIntervalRef.current);
      }
    };
  }, [isLoading, messages]);

  // Note: We no longer need to manually reset messages when conversation changes
  // because the component is keyed by chatId, causing a full remount with fresh
  // useChat state. The initialMessages prop is passed directly to useChat.

  // ---------------------------------------------------------------------------
  // HANDLERS
  // ---------------------------------------------------------------------------

  /**
   * Convert a File to a base64 data URL
   */
  const fileToDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const onSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    // Allow submission if there's text OR images
    if ((!inputValue.trim() && attachedImages.length === 0) || isLoading) return;
    
    // Check access before sending (free trial or API key)
    if (!checkAccessAndProceed()) {
      return;
    }

    // Scroll to bottom when submitting (immediate scroll)
    scrollToBottom(true);

    let messageContent = inputValue;

    if (attachedFiles.length > 0) {
      const attachmentContext = await buildAttachmentContext(attachedFiles);
      messageContent = `[Attached files]\n${attachmentContext}\n\n${messageContent}`;
    }

    if (pastedContent) {
      messageContent = `[Context from pasted text]:\n${pastedContent}\n\n[User question]:\n${inputValue}`;
    }

    // Build message parts for AI SDK v6
    // If we have images, use multimodal message format
    if (attachedImages.length > 0) {
      // Convert images to data URLs for the model
      const imageParts = await Promise.all(
        attachedImages.map(async (img) => {
          const dataUrl = await fileToDataUrl(img.file);
          return {
            type: "file" as const,
            mediaType: img.file.type,
            url: dataUrl,
          };
        })
      );

      // Clean up preview URLs before clearing state
      attachedImages.forEach((img) => URL.revokeObjectURL(img.previewUrl));

      // Clear input immediately for snappy UX
      setInputValue("");
      setPastedContent(null);
      setAttachedFiles([]);
      setAttachedImages([]);
      setShowContextDialog(false);

      // Send multimodal message with file parts and text
      // AI SDK v6 expects parts array with typed objects
      const parts: Array<{ type: "text"; text: string } | { type: "file"; mediaType: string; url: string }> = [
        ...imageParts,
      ];
      
      // Add text part if there's text content
      if (messageContent.trim()) {
        parts.push({ type: "text", text: messageContent });
      }

      sendMessage({ parts });
    } else {
      // No images - use simple text message
      // Clear input immediately for snappy UX
      setInputValue("");
      setPastedContent(null);
      setAttachedFiles([]);
      setShowContextDialog(false);

      // Send the message
      sendMessage({ text: messageContent });
    }
  };

  const handleAttachment = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const fileArray = Array.from(files);
      
      // Separate images from other files
      const imageFiles = fileArray.filter((f) => f.type.startsWith("image/"));
      const otherFiles = fileArray.filter((f) => !f.type.startsWith("image/"));
      
      // Add non-image files to attachedFiles
      if (otherFiles.length > 0) {
        setAttachedFiles((prev) => [...prev, ...otherFiles]);
      }
      
      // Add images with preview URLs
      if (imageFiles.length > 0) {
        const newImages = imageFiles.map((file) => ({
          file,
          previewUrl: URL.createObjectURL(file),
        }));
        setAttachedImages((prev) => [...prev, ...newImages]);
      }
      
      // Reset input so the same file can be selected again
      e.target.value = "";
    }
  };

  // Cleanup image preview URLs when component unmounts or images are removed
  useEffect(() => {
    return () => {
      attachedImages.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    };
  }, []);

  const removeImage = useCallback((index: number) => {
    setAttachedImages((prev) => {
      const removed = prev[index];
      if (removed) {
        URL.revokeObjectURL(removed.previewUrl);
      }
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  // Handle image-only file input
  const handleImageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const imageFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
      if (imageFiles.length > 0) {
        const newImages = imageFiles.map((file) => ({
          file,
          previewUrl: URL.createObjectURL(file),
        }));
        setAttachedImages((prev) => [...prev, ...newImages]);
      }
      // Reset the input so the same file can be selected again
      e.target.value = "";
    }
  };

  const handleImageUpload = () => {
    imageInputRef.current?.click();
  };

  // ---------------------------------------------------------------------------
  // DRAG AND DROP
  // ---------------------------------------------------------------------------

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    
    // Only show drag state if files are being dragged
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    
    // Only hide when truly leaving the drop zone
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    // Separate images from other files
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    const otherFiles = files.filter((f) => !f.type.startsWith("image/"));

    // Add document files
    if (otherFiles.length > 0) {
      setAttachedFiles((prev) => [...prev, ...otherFiles]);
    }

    // Add images with preview URLs
    if (imageFiles.length > 0) {
      const newImages = imageFiles.map((file) => ({
        file,
        previewUrl: URL.createObjectURL(file),
      }));
      setAttachedImages((prev) => [...prev, ...newImages]);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // MESSAGE EDITING
  // ---------------------------------------------------------------------------

  /**
   * Extract text content from a message's parts
   */
  const getMessageText = useCallback((message: ChatAgentUIMessage): string => {
    return extractMessageText(message);
  }, []);

  /**
   * Extract image parts from a message for editing
   */
  const getMessageImages = useCallback((message: ChatAgentUIMessage): MessageImagePart[] => {
    if (!message.parts) return [];
    const images: MessageImagePart[] = [];
    for (const part of message.parts) {
      if (part.type === "file") {
        const filePart = part as { type: "file"; mediaType?: string; url?: string; data?: string };
        if (filePart.mediaType?.startsWith("image/")) {
          images.push({
            mediaType: filePart.mediaType,
            url: filePart.url,
            data: filePart.data,
          });
        }
      }
    }
    return images;
  }, []);

  /**
   * Handle editing a user message.
   * When a user edits a message, we:
   * 1. Remove all messages after the edited one
   * 2. Update the edited message's text and images
   * 3. Re-submit to get a new response
   */
  const handleEditMessage = useCallback(
    (messageId: string, newText: string, images: { file?: File; dataUrl: string; mediaType: string }[] = []) => {
      const messageIndex = messages.findIndex((m) => m.id === messageId);
      if (messageIndex === -1) return;

      // Get messages up to and including the edited message
      const messagesUpToEdit = messages.slice(0, messageIndex);

      // Set messages to just before the edit point
      setMessages(messagesUpToEdit);

      // Send the edited message content
      setTimeout(() => {
        if (images.length > 0) {
          // Build multimodal message with images
          const imageParts = images.map(img => ({
            type: "file" as const,
            mediaType: img.mediaType,
            url: img.dataUrl,
          }));
          
          const parts: Array<{ type: "text"; text: string } | { type: "file"; mediaType: string; url: string }> = [
            ...imageParts,
          ];
          
          // Add text part if there's text content
          if (newText.trim()) {
            parts.push({ type: "text", text: newText });
          }
          
          sendMessage({ parts });
        } else {
          // Simple text message
          sendMessage({ text: newText });
        }
      }, 50);

      setEditingMessageId(null);
    },
    [messages, setMessages, sendMessage]
  );

  /**
   * Regenerate the last assistant response
   */
  const handleRegenerate = useCallback(() => {
    if (messages.length < 2) return;

    // Find the last user message
    const lastUserMessageIndex = messages
      .map((m, i) => ({ role: m.role, index: i }))
      .filter((m) => m.role === "user")
      .pop()?.index;

    if (lastUserMessageIndex === undefined) return;

    const lastUserMessage = messages[lastUserMessageIndex];
    const messagesBeforeResponse = messages.slice(0, lastUserMessageIndex);
    const userText = getMessageText(lastUserMessage);

    // Remove the response and re-send
    setMessages(messagesBeforeResponse);

    setTimeout(() => {
      sendMessage({ text: userText });
    }, 50);
  }, [messages, setMessages, sendMessage, getMessageText]);

  /**
   * Memoized callback to cancel editing - prevents inline function recreation
   */
  const handleCancelEdit = useCallback(() => {
    setEditingMessageId(null);
  }, []);

  /**
   * Memoized callback to start editing a message - prevents inline function recreation
   */
  const handleStartEdit = useCallback((messageId: string) => {
    setEditingMessageId(messageId);
  }, []);

  /**
   * Copy message content as markdown to clipboard
   */
  const handleCopyMessage = useCallback(async (message: ChatAgentUIMessage) => {
    const text = extractMessageText(message);
    await navigator.clipboard.writeText(text);
    setCopiedMessageId(message.id);
    setTimeout(() => setCopiedMessageId(null), 2000);
  }, []);

  // ---------------------------------------------------------------------------
  // TOOL APPROVAL HANDLER
  // ---------------------------------------------------------------------------

  /**
   * Handle tool approval responses for human-in-the-loop workflows.
   * Called when user approves or denies a tool execution.
   */
  const handleToolApproval = useCallback(
    (approvalId: string, approved: boolean) => {
      addToolApprovalResponse({
        id: approvalId,
        approved,
      });
    },
    [addToolApprovalResponse]
  );

  // ---------------------------------------------------------------------------
  // TOOL UI RENDERING
  // ---------------------------------------------------------------------------

  /**
   * Render a tool invocation based on its type and state.
   *
   * HOW TO ADD A NEW TOOL UI:
   * -------------------------
   * 1. Add a case for your tool name (e.g., "tool-weather")
   * 2. Import and render your custom component
   * 3. Pass the invocation for typed input/output access
   *
   * Example:
   *   case "tool-weather":
   *     return <WeatherToolView key={index} invocation={part} />;
   */
  const renderToolInvocation = (
    part: ChatAgentUIMessage["parts"][number],
    index: number,
    allParts?: ChatAgentUIMessage["parts"]
  ) => {
    // Only handle tool-* part types
    if (!part.type.startsWith("tool-")) return null;

    const toolName = part.type.replace("tool-", "");
    const invocation = part as {
      type: string;
      state: ToolInvocationState;
      toolCallId: string;
      input: Record<string, unknown>;
      output?: unknown;
      approval?: { id: string };
    };

    // Handle approval-requested state (human-in-the-loop)
    if (invocation.state === "approval-requested" && invocation.approval) {
      return (
        <div
          key={index}
          className="my-3 p-4 bg-gray-50 border border-gray-200 rounded-xl dark:bg-neutral-800 dark:border-neutral-700"
        >
          <div className="flex items-start gap-3">
            <IoAlertCircle className="w-5 h-5 text-gray-500 dark:text-neutral-400 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-gray-800 dark:text-neutral-200">
                Tool requires approval: {toolName}
              </p>
              <pre className="mt-2 text-sm text-gray-700 dark:text-neutral-300 bg-gray-100 dark:bg-neutral-700 p-2 rounded overflow-x-auto">
                {JSON.stringify(invocation.input, null, 2)}
              </pre>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant="neumorphic-success"
                  onClick={() =>
                    handleToolApproval(invocation.approval!.id, true)
                  }
                >
                  <IoCheckmark className="w-4 h-4 mr-1" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="neumorphic-destructive"
                  onClick={() =>
                    handleToolApproval(invocation.approval!.id, false)
                  }
                >
                  <IoClose className="w-4 h-4 mr-1" />
                  Deny
                </Button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    // save_to_context tool - progress is shown in the unified AgentOrchestratorView
    // Only render the orchestrator on the FIRST save_to_context call in this message
    if (toolName === "save_to_context") {
      // Check if this is the first save_to_context in the message parts
      if (allParts) {
        const saveContextParts = allParts.filter(
          (p) => p.type === "tool-save_to_context"
        );
        const firstSaveContextIndex = allParts.findIndex(
          (p) => p.type === "tool-save_to_context"
        );
        
        // Only render orchestrator at the position of the first save_to_context call
        // Pass the count of save_to_context calls so all slots render immediately
        if (firstSaveContextIndex === index && orchestratorState) {
          return (
            <AgentOrchestratorView 
              key={index} 
              state={orchestratorState} 
              expectedAgentCount={saveContextParts.length}
            />
          );
        }
      }
      // Return null for subsequent save_to_context calls
      return null;
    }

    // Knowledge filesystem tools - use beautiful neumorphic UI
    const knowledgeTools = [
      "kb_list",
      "kb_read",
      "kb_write",
      "kb_append",
      "kb_mkdir",
      "kb_delete",
      "kb_search",
    ];

    if (knowledgeTools.includes(toolName)) {
      return (
        <KnowledgeToolView key={index} toolName={toolName} invocation={invocation} />
      );
    }

    // Knowledge graph tools - link, unlink, links, graph
    const knowledgeLinkTools = ["kb_link", "kb_unlink", "kb_links", "kb_graph"];
    if (knowledgeLinkTools.includes(toolName)) {
      return (
        <KnowledgeLinkToolView key={index} toolName={toolName} invocation={invocation} />
      );
    }

    // Web search tool - beautiful neumorphic UI
    // Handle both custom web_search and Anthropic's provider-defined webSearch tool
    // The tool can appear as: web_search, webSearch, webSearch_20250305, etc.
    if (
      toolName === "web_search" || 
      toolName.startsWith("webSearch") || 
      toolName.toLowerCase().includes("websearch") ||
      toolName.toLowerCase().includes("web_search")
    ) {
      return <WebSearchView key={index} invocation={invocation} />;
    }

    // Chat history search tool - expressive neumorphic UI showing query and results
    if (toolName === "chat_search") {
      return <ChatSearchView key={index} invocation={invocation} />;
    }

    // Document search tool - for large uploaded documents
    if (toolName === "document_search") {
      return <DocumentSearchView key={index} invocation={invocation} />;
    }

    // Document list tool - lists all uploaded documents
    if (toolName === "document_list") {
      return <DocumentListView key={index} invocation={invocation} />;
    }

    // PDF export tool - exports chat as PDF with markdown/LaTeX rendering
    if (toolName === "pdf_export") {
      return <PdfExportView key={index} invocation={invocation} />;
    }

    // All other tools - use generic neumorphic UI
    return <GenericToolView key={index} toolName={toolName} invocation={invocation} />;
  };

  // ---------------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------------
  return (
    <div 
      className="flex flex-col h-full w-full overflow-hidden relative bg-white dark:bg-neutral-950 neu-context-white"
    >
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-neutral-800 h-[48px] flex-shrink-0">
        {/* Left side: Model selector + Token count */}
        <div className="flex items-center gap-3">
          {/* Model selector - pure neumorphic inset toggle */}
          <button
            onClick={() => {
              const newTier = modelTier === "sonnet" ? "opus" : "sonnet";
              console.log("[Model Selector] Switching from", modelTier, "to", newTier);
              setModelTier(newTier);
            }}
            className={cn(
              "relative px-4 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all duration-300 select-none",
              // Pure neumorphic styling - no gray, uses page background
              "bg-white dark:bg-neutral-950",
              // Neumorphic inset effect
              "shadow-[inset_2px_2px_5px_rgba(0,0,0,0.08),inset_-2px_-2px_5px_rgba(255,255,255,0.8)]",
              "dark:shadow-[inset_2px_2px_5px_rgba(0,0,0,0.4),inset_-2px_-2px_5px_rgba(255,255,255,0.03)]",
              // Text color - dark grey for Sonnet, black for Opus
              modelTier === "sonnet"
                ? "text-gray-500 dark:text-neutral-400"
                : "text-black dark:text-white",
              // Hover - deeper inset
              "hover:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.1),inset_-3px_-3px_6px_rgba(255,255,255,0.9)]",
              "dark:hover:shadow-[inset_3px_3px_6px_rgba(0,0,0,0.5),inset_-3px_-3px_6px_rgba(255,255,255,0.04)]",
              // Active - even deeper inset
              "active:shadow-[inset_4px_4px_8px_rgba(0,0,0,0.12),inset_-4px_-4px_8px_rgba(255,255,255,0.7)]",
              "dark:active:shadow-[inset_4px_4px_8px_rgba(0,0,0,0.6),inset_-4px_-4px_8px_rgba(255,255,255,0.02)]"
            )}
            title={`Click to switch to ${modelTier === "sonnet" ? "Opus" : "Sonnet"}`}
          >
            <span className="relative z-10">
              {modelTier === "sonnet" ? "Sonnet" : "Opus"}
            </span>
          </button>
          
          {/* Token count display */}
          <span 
            className="text-xs text-gray-400 dark:text-neutral-500 font-mono tabular-nums"
            title={`Estimated ${tokenCount.toLocaleString()} tokens in this conversation`}
          >
            ~{formatTokenCount(tokenCount)} tokens
          </span>
        </div>
        
        {/* Right side: Title */}
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-neutral-500">Le Chat Noir</h2>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mx-8 mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm flex-shrink-0">
          <strong>Error:</strong> {error.message}
          {(error.message.includes("API") || error.message.includes("key")) && (
            <p className="mt-2 text-xs">
              Open Settings in the sidebar to add your API keys, or sign in with an owner account.
            </p>
          )}
        </div>
      )}
      
      {/* Free Trial Exhausted Warning */}
      {showTrialExhausted && !isOwner && !apiKeys.anthropicApiKey && (
        <div className="mx-8 mt-4 p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-700 dark:text-amber-400 text-sm flex-shrink-0">
          <strong>Free trial ended!</strong> You&apos;ve used all {5} free chats.
          <p className="mt-2 text-xs">
            To continue, please open <button 
              onClick={() => onRequestSettings?.()} 
              className="font-medium underline hover:no-underline"
            >
              Settings
            </button> in the sidebar to add your API key or sign in with an owner account.
          </p>
        </div>
      )}
      
      {/* Messages area - takes remaining space above the input */}
      <div 
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-8 py-6 min-h-0"
      >
        <div className="w-full space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full min-h-[60vh]">
              {/* Animated Blob with Circling Text */}
              <style>{`
                .blob-container {
                  transition: transform 0.4s ease-out;
                }
                .blob-container:hover {
                  transform: scale(1.15);
                }
                .blob-container:hover .blob-text {
                  fill: white;
                  mix-blend-mode: overlay;
                }
                .blob-container:hover .cat-image {
                  opacity: 1;
                }
                .blob-container:hover .blob-gradient-bg {
                  opacity: 0;
                }
                .blob-text {
                  font: 700 10px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
                  letter-spacing: 1.5px;
                  text-transform: uppercase;
                  fill: #1f2937;
                  mix-blend-mode: normal;
                  transition: ease fill 0.5s;
                }
                .cat-image {
                  opacity: 0;
                  transition: opacity 0.4s ease-out;
                }
                .blob-gradient-bg {
                  transition: opacity 0.4s ease-out;
                }
              `}</style>
              <div className="blob-container relative w-[320px] h-[320px] sm:w-[380px] sm:h-[380px] cursor-pointer">
                <svg
                  viewBox="0 0 200 200"
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-full h-full"
                  style={{ overflow: "visible" }}
                >
                  {/* Gradient background for blob */}
                  <defs>
                    <linearGradient id={`blobGradient-${chatId}`} x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#1a1a2e" />
                      <stop offset="50%" stopColor="#16213e" />
                      <stop offset="100%" stopColor="#0f3460" />
                    </linearGradient>
                    {/* Clip path using the blob shape */}
                    <clipPath id={`blobClip-${chatId}`}>
                      <path
                        d="M43.1,-68.5C56.2,-58.6,67.5,-47.3,72.3,-33.9C77.2,-20.5,75.5,-4.9,74.2,11.3C72.9,27.6,71.9,44.5,63.8,57.2C55.7,69.8,40.6,78.2,25.5,79.2C10.4,80.1,-4.7,73.6,-20.9,69.6C-37.1,65.5,-54.5,63.9,-66,54.8C-77.5,45.8,-83.2,29.3,-85.7,12.3C-88.3,-4.8,-87.7,-22.3,-79.6,-34.8C-71.5,-47.3,-55.8,-54.9,-41.3,-64.2C-26.7,-73.6,-13.4,-84.7,0.8,-86C15,-87.2,29.9,-78.5,43.1,-68.5Z"
                      />
                    </clipPath>
                    {/* Filter to colorize black strokes with the gradient colors */}
                    <filter id={`colorize-${chatId}`} colorInterpolationFilters="sRGB">
                      {/* Convert to grayscale first */}
                      <feColorMatrix type="matrix" values="0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0 0 0 1 0" result="gray"/>
                      {/* Invert so black becomes white (will pick up gradient) */}
                      <feComponentTransfer result="inverted">
                        <feFuncR type="table" tableValues="1 0"/>
                        <feFuncG type="table" tableValues="1 0"/>
                        <feFuncB type="table" tableValues="1 0"/>
                      </feComponentTransfer>
                      {/* Use as alpha mask */}
                      <feColorMatrix type="matrix" values="0 0 0 0 0.094 0 0 0 0 0.129 0 0 0 0 0.376 1 0 0 0 0" result="colored"/>
                    </filter>
                    {/* Text path defined in defs - uses chatId to ensure uniqueness */}
                    <path
                      id={`textPath-${chatId}`}
                      d="M43.1,-68.5C56.2,-58.6,67.5,-47.3,72.3,-33.9C77.2,-20.5,75.5,-4.9,74.2,11.3C72.9,27.6,71.9,44.5,63.8,57.2C55.7,69.8,40.6,78.2,25.5,79.2C10.4,80.1,-4.7,73.6,-20.9,69.6C-37.1,65.5,-54.5,63.9,-66,54.8C-77.5,45.8,-83.2,29.3,-85.7,12.3C-88.3,-4.8,-87.7,-22.3,-79.6,-34.8C-71.5,-47.3,-55.8,-54.9,-41.3,-64.2C-26.7,-73.6,-13.4,-84.7,0.8,-86C15,-87.2,29.9,-78.5,43.1,-68.5Z"
                      fill="none"
                      stroke="none"
                      pathLength="100"
                    />
                  </defs>
                  
                  {/* Everything wrapped in a group that translates to center */}
                  <g transform="translate(100 100)">
                    {/* Main blob shape with gradient - fades out on hover */}
                    <path
                      className="blob-gradient-bg"
                      d="M43.1,-68.5C56.2,-58.6,67.5,-47.3,72.3,-33.9C77.2,-20.5,75.5,-4.9,74.2,11.3C72.9,27.6,71.9,44.5,63.8,57.2C55.7,69.8,40.6,78.2,25.5,79.2C10.4,80.1,-4.7,73.6,-20.9,69.6C-37.1,65.5,-54.5,63.9,-66,54.8C-77.5,45.8,-83.2,29.3,-85.7,12.3C-88.3,-4.8,-87.7,-22.3,-79.6,-34.8C-71.5,-47.3,-55.8,-54.9,-41.3,-64.2C-26.7,-73.6,-13.4,-84.7,0.8,-86C15,-87.2,29.9,-78.5,43.1,-68.5Z"
                      fill={`url(#blobGradient-${chatId})`}
                    />
                    
                    {/* Cat image - clipped to blob shape, fades in on hover */}
                    <g clipPath={`url(#blobClip-${chatId})`} className="cat-image">
                      {/* White background for the cat */}
                      <rect x="-100" y="-100" width="200" height="200" fill="white" />
                      {/* The cat image with gradient overlay effect - smaller size = zoomed out */}
                      <image
                        href="/ChatNoire.png"
                        x="-60"
                        y="-60"
                        width="120"
                        height="120"
                        preserveAspectRatio="xMidYMid meet"
                        style={{ mixBlendMode: "multiply" }}
                      />
                      {/* Gradient overlay that shows through the black strokes */}
                      <rect 
                        x="-100" 
                        y="-100" 
                        width="200" 
                        height="200" 
                        fill={`url(#blobGradient-${chatId})`}
                        style={{ mixBlendMode: "screen" }}
                      />
                    </g>
                    
                    {/* Use the path for text - same transform applied via parent group */}
                    <use href={`#textPath-${chatId}`} />

                    {/* Animated circling text */}
                    <text className="blob-text">
                      <textPath href={`#textPath-${chatId}`} startOffset="0%">✦ ASK ME ANYTHING ✦ ASK ME ANYTHING ✦ ASK ME ANYTHING ✦ ASK ME ANYTHING
                        <animate attributeName="startOffset" from="0%" to="100%" dur="15s" repeatCount="indefinite" />
                      </textPath>
                      <textPath href={`#textPath-${chatId}`} startOffset="100%">✦ ASK ME ANYTHING ✦ ASK ME ANYTHING ✦ ASK ME ANYTHING ✦ ASK ME ANYTHING
                        <animate attributeName="startOffset" from="-100%" to="0%" dur="15s" repeatCount="indefinite" />
                      </textPath>
                    </text>
                  </g>
                </svg>
              </div>
              
              <p className="text-gray-500 dark:text-neutral-500 mt-6">
                I can discuss anything, store context across conversations, and search the web lightning fast.
              </p>
            </div>
          )}

          {messages.map((message, messageIndex) => {
            const isEditing = editingMessageId === message.id;
            const messagesAfterCount = messages.length - messageIndex - 1;
            
            return (
            <div
              key={`${message.id}-${messageIndex}`}
              className={cn(
                "group flex",
                message.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              <div
                className={cn(
                  "relative rounded-2xl",
                  message.role === "user"
                    ? isEditing 
                      ? "max-w-[90%] w-full sm:max-w-[80%] px-4 py-3 bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-700 shadow-lg"
                      : "max-w-[80%] px-4 py-2 neu-outset text-gray-900 dark:text-neutral-300"
                    : "max-w-[80%] px-4 py-2 bg-transparent text-gray-900 dark:text-neutral-500"
                )}
              >
                {/* Message content or editor */}
                {isEditing ? (
                  <MessageEditor
                    initialText={getMessageText(message)}
                    initialImages={getMessageImages(message)}
                    onSave={(newText, images) => handleEditMessage(message.id, newText, images)}
                    onCancel={handleCancelEdit}
                    messagesAfterCount={messagesAfterCount}
                  />
                ) : (
                  <>
                    {message.parts?.map((part, index) => {
                      // Handle text parts
                      if (part.type === "text") {
                        if (message.role === "assistant") {
                          // Determine if this is the currently streaming message
                          // (last assistant message while isLoading is true)
                          const isLastMessage = messageIndex === messages.length - 1;
                          const isStreamingMessage = isLoading && isLastMessage;
                          
                          // Use streaming-aware component for the active message,
                          // regular memoized component for completed messages
                          return (
                            <StreamingMarkdownContent
                              key={index}
                              text={part.text || ""}
                              isStreaming={isStreamingMessage}
                            />
                          );
                        }
                        return (
                          <span key={index} className="whitespace-pre-wrap">
                            {part.text}
                          </span>
                        );
                      }

                      // Handle tool invocations
                      if (part.type.startsWith("tool-")) {
                        return renderToolInvocation(part, index, message.parts);
                      }

                      // Handle reasoning parts (if model supports it)
                      if (part.type === "reasoning") {
                        return (
                          <div
                            key={index}
                            className="my-2 p-3 bg-purple-50 border border-purple-200 rounded-lg text-purple-800 text-sm italic"
                          >
                            <span className="font-medium">Thinking: </span>
                            {(part as { text?: string }).text}
                          </div>
                        );
                      }

                      // Handle file parts (images, PDFs, etc.)
                      if (part.type === "file") {
                        const filePart = part as { 
                          type: "file"; 
                          mediaType?: string; 
                          url?: string;
                          data?: string; // base64 data without prefix
                        };
                        
                        // Handle image files
                        if (filePart.mediaType?.startsWith("image/")) {
                          const imageUrl = filePart.url || (filePart.data ? `data:${filePart.mediaType};base64,${filePart.data}` : null);
                          if (imageUrl) {
                            return (
                              <div key={index} className="my-2">
                                <img
                                  src={imageUrl}
                                  alt="Attached image"
                                  className="max-w-full max-h-96 rounded-lg border border-gray-200 dark:border-neutral-700 object-contain"
                                  loading="lazy"
                                />
                              </div>
                            );
                          }
                        }
                        
                        // Handle PDFs as embeds
                        if (filePart.mediaType === "application/pdf" && filePart.url) {
                          return (
                            <div key={index} className="my-2">
                              <iframe
                                src={filePart.url}
                                className="w-full h-96 rounded-lg border border-gray-200 dark:border-neutral-700"
                                title="PDF document"
                              />
                            </div>
                          );
                        }
                        
                        // Fallback for other file types
                        return (
                          <div
                            key={index}
                            className="my-2 p-3 bg-gray-50 dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-lg text-sm"
                          >
                            <IoDocumentText className="inline w-4 h-4 mr-2" />
                            File attachment ({filePart.mediaType || "unknown type"})
                          </div>
                        );
                      }

                      return null;
                    }) || (
                      <div className="flex gap-1">
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0.1s]" />
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                      </div>
                    )}
                    
                    {/* Edit button for user messages - now inside the bubble */}
                    {message.role === "user" && !isLoading && (
                      <button
                        onClick={() => handleStartEdit(message.id)}
                        className="mt-2 -mb-0.5 flex items-center gap-1 text-xs text-gray-400 dark:text-neutral-500 hover:text-gray-600 dark:hover:text-neutral-300 transition-colors opacity-0 group-hover:opacity-100"
                        title="Edit and resend this message"
                      >
                        <IoPencil className="w-3 h-3" />
                        <span>Edit</span>
                      </button>
                    )}
                  </>
                )}

                {/* Action buttons for assistant messages */}
                {message.role === "assistant" && !isLoading && (
                  <div className="mt-2 -mb-1 flex items-center gap-3">
                    {/* Copy as markdown button */}
                    <button
                      onClick={() => handleCopyMessage(message)}
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:text-neutral-500 dark:hover:text-neutral-300 transition-colors"
                      title="Copy as markdown"
                    >
                      {copiedMessageId === message.id ? (
                        <>
                          <IoCheckmark className="w-3 h-3 text-green-500" />
                          <span className="text-green-500">Copied</span>
                        </>
                      ) : (
                        <>
                          <IoCopy className="w-3 h-3" />
                          Copy
                        </>
                      )}
                    </button>
                    
                    {/* Regenerate button - only for last message */}
                    {messageIndex === messages.length - 1 && (
                      <button
                        onClick={handleRegenerate}
                        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:text-neutral-500 dark:hover:text-neutral-300 transition-colors"
                        title="Regenerate response"
                      >
                        <IoReload className="w-3 h-3" />
                        Regenerate
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
          })}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Form - grows upward when expanded */}
      <form 
        onSubmit={onSubmit} 
        className="w-full px-8 pb-6 pt-4 flex-shrink-0 bg-white dark:bg-neutral-950"
        style={{
          // Collapsed: auto height (natural content size)
          // Expanded: takes up most of the screen
          height: isInputExpanded ? 'calc(100vh - 325px)' : 'auto',
          transition: 'height 300ms ease-out',
          display: 'flex',
          flexDirection: 'column',
        }}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <div 
          className="bg-white dark:bg-neutral-950 rounded-3xl border border-gray-200 dark:border-neutral-800 shadow-lg p-5 flex flex-col flex-1 min-h-0"
        >
          {/* Context Dialog - shows above textarea when active */}
          {showContextDialog && (
            <div className="mb-3 p-4 bg-gradient-to-br from-gray-50/80 to-white dark:from-neutral-900 dark:to-neutral-850 rounded-2xl border border-gray-200/80 dark:border-neutral-700/50 shadow-sm backdrop-blur-sm">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-medium text-gray-700 dark:text-neutral-300">Add Context</span>
                <button
                  type="button"
                  onClick={() => setShowContextDialog(false)}
                  className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-lg transition-all"
                >
                  <IoClose className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3">
                {/* Upload buttons row */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleAttachment}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-xl text-sm font-medium text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-750 hover:border-gray-300 dark:hover:border-neutral-600 transition-all shadow-sm"
                  >
                    <IoDocumentText className="w-4 h-4 text-blue-500" />
                    <span>Documents</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleImageUpload}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-white dark:bg-neutral-800 border border-gray-200 dark:border-neutral-700 rounded-xl text-sm font-medium text-gray-700 dark:text-neutral-300 hover:bg-gray-50 dark:hover:bg-neutral-750 hover:border-gray-300 dark:hover:border-neutral-600 transition-all shadow-sm"
                  >
                    <IoImage className="w-4 h-4 text-emerald-500" />
                    <span>Images</span>
                  </button>
                </div>

                {/* Divider with "or" */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-gray-200 dark:bg-neutral-700" />
                  <span className="text-xs text-gray-400 dark:text-neutral-500">or paste text</span>
                  <div className="flex-1 h-px bg-gray-200 dark:bg-neutral-700" />
                </div>

                <Textarea
                  placeholder="Paste content here and press Enter..."
                  className="min-h-[80px] resize-none text-sm bg-white dark:bg-neutral-800 border-gray-200 dark:border-neutral-700 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 dark:focus:border-blue-500 transition-all"
                  onChange={(e) => {
                    const content = e.target.value;
                    if (content.trim()) {
                      const words = content.split(/\s+/).length;
                      if (words > 100000) {
                        alert("Content exceeds 100,000 words limit");
                        return;
                      }
                      setPastedContent(content);
                      e.target.value = "";
                    }
                  }}
                />
              </div>
            </div>
          )}

          {/* Attached Files & Images Display */}
          {(attachedFiles.length > 0 || attachedImages.length > 0 || pastedContent) && (
            <div className="mb-3 flex flex-wrap gap-2">
              {/* Image Previews */}
              {attachedImages.map((img, index) => (
                <div
                  key={`img-${index}`}
                  className="relative group"
                >
                  <img
                    src={img.previewUrl}
                    alt={img.file.name}
                    className="h-16 w-auto rounded-lg border border-gray-200 dark:border-neutral-700 object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(index)}
                    className="absolute -top-1.5 -right-1.5 p-1 bg-red-500 hover:bg-red-600 text-white rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <IoClose className="w-3 h-3" />
                  </button>
                  <span className="absolute bottom-0.5 left-0.5 right-0.5 text-[10px] text-white bg-black/50 rounded px-1 truncate">
                    {img.file.name}
                  </span>
                </div>
              ))}
              {/* Document Files */}
              {attachedFiles.map((file, index) => (
                <div
                  key={`file-${index}`}
                  className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-50 dark:bg-neutral-800/50 border border-blue-200 dark:border-neutral-600 rounded-lg text-sm text-blue-700 dark:text-neutral-300"
                >
                  <IoDocumentText className="w-3.5 h-3.5" />
                  <span className="max-w-[200px] truncate">{file.name}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setAttachedFiles((prev) =>
                        prev.filter((_, i) => i !== index)
                      )
                    }
                    className="text-blue-400 hover:text-blue-600 dark:hover:text-neutral-200 transition-colors"
                  >
                    <IoClose className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {pastedContent && (
                <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-50 dark:bg-neutral-800/50 border border-blue-200 dark:border-neutral-600 rounded-lg text-sm text-blue-700 dark:text-neutral-300">
                  <IoDocumentText className="w-3.5 h-3.5" />
                  <span>
                    Pasted text (
                    {pastedContent.split(/\s+/).length.toLocaleString()} words)
                  </span>
                  <button
                    type="button"
                    onClick={() => setPastedContent(null)}
                    className="text-blue-400 hover:text-blue-600 dark:hover:text-neutral-200 transition-colors"
                  >
                    <IoClose className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Text Input - grows when expanded */}
          <div 
            className={cn(
              "flex-1 min-h-0 flex flex-col relative rounded-xl transition-all duration-200",
              isDragging && "bg-gray-100 dark:bg-neutral-800 shadow-[inset_4px_4px_8px_rgba(0,0,0,0.08),inset_-4px_-4px_8px_rgba(255,255,255,0.8)] dark:shadow-[inset_4px_4px_8px_rgba(0,0,0,0.3),inset_-4px_-4px_8px_rgba(60,60,60,0.2)]"
            )}
          >
            {/* Drag overlay - covers the text area */}
            {isDragging && (
              <div className="absolute inset-0 z-20 rounded-xl flex items-center justify-center pointer-events-none">
                <div className="flex items-center gap-2 text-gray-500 dark:text-neutral-400">
                  <IoCloudUpload className="w-5 h-5" />
                  <span className="font-medium text-sm">Drop files here</span>
                </div>
              </div>
            )}
            {/* Expand/Collapse Toggle - top right corner (hidden when dragging) */}
            {!isDragging && (
              <button
                type="button"
                onClick={() => {
                  setIsInputExpanded(!isInputExpanded);
                  // Focus textarea after expanding
                  setTimeout(() => textareaRef.current?.focus(), 100);
                }}
                className={cn(
                  "absolute top-0 right-0 p-1.5 rounded-lg transition-all duration-200 z-10",
                  "hover:bg-gray-100 dark:hover:bg-neutral-800 text-gray-400 hover:text-gray-600 dark:hover:text-neutral-300"
                )}
                title={isInputExpanded ? "Minimize editor" : "Expand editor"}
              >
                <div className="relative w-4 h-4">
                  <IoExpand 
                    className={cn(
                      "w-4 h-4 absolute inset-0 transition-all duration-200",
                      isInputExpanded ? "opacity-0 rotate-90 scale-75" : "opacity-100 rotate-0 scale-100"
                    )} 
                  />
                  <IoContract 
                    className={cn(
                      "w-4 h-4 absolute inset-0 transition-all duration-200",
                      isInputExpanded ? "opacity-100 rotate-0 scale-100" : "opacity-0 -rotate-90 scale-75"
                    )} 
                  />
                </div>
              </button>
            )}

            {/* Textarea - invisible when dragging but keeps height */}
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !isInputExpanded) {
                  e.preventDefault();
                  onSubmit();
                }
                // In expanded mode, allow Enter for new lines, use Cmd/Ctrl+Enter to submit
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && isInputExpanded) {
                  e.preventDefault();
                  onSubmit();
                }
                // Escape to minimize
                if (e.key === "Escape" && isInputExpanded) {
                  setIsInputExpanded(false);
                }
              }}
              placeholder={isInputExpanded 
                ? "Write your message... (Cmd+Enter to send, Escape to minimize)" 
                : "Ask, search, or make anything..."
              }
              className={cn(
                "w-full text-gray-900 dark:text-neutral-500 bg-transparent placeholder:text-gray-400 dark:placeholder:text-neutral-500 resize-none focus:outline-none leading-relaxed transition-opacity duration-200",
                isInputExpanded 
                  ? "flex-1 text-base" 
                  : "min-h-[80px] text-lg",
                isDragging && "opacity-0"
              )}
            />
          </div>

          {/* Bottom Bar */}
          <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-neutral-800 flex-shrink-0">
            <div className="flex items-center gap-1">
              {/* Hidden file inputs */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,text/*,application/pdf,application/json,application/xml,.txt,.md,.csv,.json,.xml,.pdf"
                className="hidden"
                onChange={handleFileChange}
              />
              <input
                ref={imageInputRef}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="hidden"
                onChange={handleImageInputChange}
              />

              {/* Mode Dropdown */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowModeDropdown(!showModeDropdown)}
                  className="inline-flex items-center gap-1.5 text-gray-700 dark:text-neutral-500 text-sm font-medium hover:bg-gray-100 dark:hover:bg-neutral-800 px-3 py-1.5 rounded-lg transition-all"
                >
                  {mode}
                  <IoChevronDown className="w-3.5 h-3.5" />
                </button>

                {showModeDropdown && (
                  <div className="absolute left-0 bottom-full mb-2 w-56 bg-white dark:bg-neutral-800 rounded-xl border border-gray-200 dark:border-neutral-700 shadow-lg p-1 z-10">
                    <div className="px-3 py-2 text-sm font-medium text-gray-500 dark:text-neutral-500 border-b border-gray-100 dark:border-neutral-700">
                      Select Agent Mode
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setMode("Auto");
                        setShowModeDropdown(false);
                      }}
                      className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-neutral-700 rounded-lg transition-colors"
                    >
                      <span className="text-gray-900 dark:text-neutral-500 font-medium">Auto</span>
                      {mode === "Auto" && (
                        <IoCheckmark className="w-4 h-4 text-gray-900 dark:text-neutral-500" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMode("Agent Mode");
                        setShowModeDropdown(false);
                      }}
                      className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-neutral-700 rounded-lg transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-gray-900 dark:text-neutral-500 font-medium">
                          Agent Mode
                        </span>
                        <Badge
                          variant="secondary"
                          className="bg-blue-100 dark:bg-neutral-700/50 text-blue-700 dark:text-neutral-300 hover:bg-blue-100 dark:hover:bg-neutral-700/50 text-xs"
                        >
                          Beta
                        </Badge>
                      </div>
                      {mode === "Agent Mode" && (
                        <IoCheckmark className="w-4 h-4 text-gray-900 dark:text-neutral-500" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMode("Plan Mode");
                        setShowModeDropdown(false);
                      }}
                      className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-neutral-700 rounded-lg transition-colors"
                    >
                      <span className="text-gray-900 dark:text-neutral-500 font-medium">
                        Plan Mode
                      </span>
                      {mode === "Plan Mode" && (
                        <IoCheckmark className="w-4 h-4 text-gray-900 dark:text-neutral-500" />
                      )}
                    </button>
                  </div>
                )}
              </div>

              {/* Separator */}
              <div className="w-px h-4 bg-gray-200 dark:bg-neutral-700 mx-1" />

              {/* Source Button */}
              <button
                type="button"
                onClick={() => {
                  const sources = [
                    "All Sources",
                    "Web Only",
                    "Docs Only",
                    "Code Only",
                  ];
                  const currentIndex = sources.indexOf(selectedSource);
                  const nextIndex = (currentIndex + 1) % sources.length;
                  setSelectedSource(sources[nextIndex]);
                }}
                className="inline-flex items-center gap-2 text-gray-700 dark:text-neutral-500 text-sm font-medium hover:bg-gray-100 dark:hover:bg-neutral-800 px-3 py-1.5 rounded-lg transition-all"
                title="Change source"
              >
                <IoGlobeOutline className="w-4 h-4" />
                {selectedSource}
              </button>

              {/* Separator */}
              <div className="w-px h-4 bg-gray-200 dark:bg-neutral-700 mx-1" />

              {/* Add Context Button */}
              <button
                type="button"
                onClick={() => setShowContextDialog(!showContextDialog)}
                className={cn(
                  "inline-flex items-center gap-2 text-sm font-medium px-3 py-1.5 rounded-xl transition-all duration-200",
                  showContextDialog || attachedFiles.length > 0 || attachedImages.length > 0 || pastedContent
                    ? "bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 text-blue-600 dark:text-blue-400 border border-blue-200/50 dark:border-blue-800/50 shadow-sm"
                    : "text-gray-500 dark:text-neutral-400 hover:text-gray-700 dark:hover:text-neutral-300 hover:bg-gray-100/80 dark:hover:bg-neutral-800/80"
                )}
                title="Add files, images, or paste content"
              >
                <IoAdd className="w-4 h-4" />
                <span className="hidden sm:inline">
                  {attachedFiles.length > 0 || attachedImages.length > 0 || pastedContent
                    ? `${attachedFiles.length + attachedImages.length + (pastedContent ? 1 : 0)} item${(attachedFiles.length + attachedImages.length + (pastedContent ? 1 : 0)) !== 1 ? 's' : ''}`
                    : "Context"}
                </span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              {/* Submit hint when expanded */}
              {isInputExpanded && (
                <span className="text-xs text-gray-400 dark:text-neutral-500 mr-2">
                  {navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+Enter to send
                </span>
              )}
              
              {/* Submit Button - Neumorphic Style */}
              <Button
                type="submit"
                variant="neumorphic-primary"
                size="icon"
                disabled={(!inputValue.trim() && attachedImages.length === 0) || isLoading}
                className="w-11 h-11"
              >
                <IoArrowUp className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
