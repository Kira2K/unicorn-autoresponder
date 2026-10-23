// An RPC 5xx can have an uncertain outcome and must never authorize another send.
function definiteRejection(e){return e.code==='ACCOUNT_FLOOD_STOPPED'||/^(?:RECIPIENT_SCOPE_CHANGED|NOT_GROUP_DESTINATION|NOT_IN_DESTINATION_DIALOGS|DESTINATION_UNAVAILABLE|STUDENT_IDENTITY_UNKNOWN|STUDENT_IDENTITY_INVALID|STUDENT_NOT_IN_DESTINATION)$/.test(e.errorMessage||'')||!!e.errorMessage&&((Number(e.code)>=400&&Number(e.code)<500)||/^(?:FLOOD|PEER_FLOOD|FLOOD_WAIT_\d+)$/.test(e.errorMessage));}
module.exports={definiteRejection};
